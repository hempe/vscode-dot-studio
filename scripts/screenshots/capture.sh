#!/usr/bin/env bash
# Captures the screenshots and GIFs of the README and docs (docs/images/*.png, *.gif): VS Code runs with this extension in a
# virtual display (Xvfb), in a throwaway profile, on a copy of the sample solution, and xdotool steers it.
# Rerun after UI or theme changes.
#
#   scripts/screenshots/capture.sh ["Theme Name"]     e.g. "Default Light Modern"; default "Default Dark Modern"
#
# Needs: Xvfb and xdotool (Arch: pacman -S xorg-server-xvfb xdotool), ImageMagick, the .NET SDK, code-oss or
# code, a built extension (npm run build:dev) and network access (NuGet). The solution is sample/ (Contoso), copied
# to a temporary folder.
# Environment: CODE (default code-oss),
# CSHARP_EXT (C# extension folder, default the newest muhammad-sammy.csharp or ms-dotnettools.csharp),
# SCENES (space-separated scene names to capture, default all), KEEP=1 keeps the work folder.
set -euo pipefail

THEME="${1:-Default Dark Modern}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$REPO/docs/images"
CODE="${CODE:-code-oss}"
CSHARP_EXT="${CSHARP_EXT:-$(ls -d "$HOME"/.vscode-oss/extensions/muhammad-sammy.csharp-* "$HOME"/.vscode/extensions/ms-dotnettools.csharp-* 2>/dev/null | tail -1 || true)}"
SCENES="${SCENES:-solution-explorer dependencies context-menu error-list tests nuget new-project publish gif-navigate gif-nuget gif-new-project gif-configuration-manager gif-startup-projects gif-attach-to-process gif-dev-cert gif-hot-reload gif-code-cleanup gif-sync-namespaces gif-show-all-files gif-drag-and-drop gif-central-packages gif-grpc}"
GIF_FPS=8
GIF_WIDTH=960
DISPLAY_NUMBER=97
WIDTH=1600
HEIGHT=1000

WORK="$(mktemp -d /tmp/shinobi-shots-XXXX)"
export DISPLAY=":$DISPLAY_NUMBER"
XVFB_PID=""
CODE_PID=""
APP_PID=""
# Stops the sample web app of the attach scene (it runs in its own process group, apphost child included)
stop_app() { [ -n "$APP_PID" ] && { kill -- "-$APP_PID" 2>/dev/null || true; APP_PID=""; }; return 0; }
cleanup() {
    stop_app
    [ -n "$FFMPEG_PID" ] && kill "$FFMPEG_PID" 2>/dev/null || true
    [ -n "$CODE_PID" ] && kill "$CODE_PID" 2>/dev/null || true
    [ -n "$XVFB_PID" ] && kill "$XVFB_PID" 2>/dev/null || true
    # VS Code's helper processes can still write to the profile for a moment
    if [ -z "${KEEP:-}" ]; then sleep 3; rm -rf -- "$WORK" 2>/dev/null || { sleep 5; rm -rf -- "$WORK"; }; else echo "Work folder kept: $WORK"; fi
}
trap cleanup EXIT

# --- helpers -------------------------------------------------------------------------------------------------

key() { xdotool key --clearmodifiers "$@"; sleep 0.5; }
type_text() { xdotool type --delay 30 "$1"; sleep 0.5; }
click() { xdotool mousemove "$1" "$2" click "${3:-1}"; sleep 0.8; }
double_click() { xdotool mousemove "$1" "$2" click --repeat 2 --delay 80 1; sleep 0.8; }
pause() { sleep "${1:-1}"; }
# Runs a command from the command palette
command() { key ctrl+shift+p; pause 0.8; type_text "$1"; pause 1; key Return; pause "${2:-2}"; }
# Saves the screen as docs/images/<name>.png, cropped to WxH+X+Y; by default without the title bar, which says
# "[Extension Development Host]"
shot() {
    import -window root "$WORK/$1.png"
    magick "$WORK/$1.png" -crop "${2:-${WIDTH}x$((HEIGHT - 35))+0+35}" +repage "$OUT/$1.png"
    echo "  $OUT/$1.png"
}
# Screen recording for the GIFs: record_start before the steps, record_stop <name> after; the title bar is cropped
# away, the result is docs/images/<name>.gif (palette per file, so the colours stay close to the screen).
# record_pause leaves a long wait out (a restore, a download): record_start goes on with the next part, record_stop
# joins the parts
FFMPEG_PID=""
REC_PARTS=0
record_start() {
    REC_PARTS=$(( REC_PARTS + 1 ))
    ffmpeg -loglevel error -y -f x11grab -framerate 15 -video_size "${WIDTH}x${HEIGHT}" -i "$DISPLAY" \
        -vf "crop=${WIDTH}:$((HEIGHT - 36)):0:36" -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p "$WORK/rec-$REC_PARTS.mp4" &
    FFMPEG_PID=$!
    sleep 1
}
record_pause() { kill -INT "$FFMPEG_PID"; wait "$FFMPEG_PID" 2>/dev/null || true; FFMPEG_PID=""; }
record_stop() {
    record_pause
    local i; : > "$WORK/rec.txt"
    for (( i = 1; i <= REC_PARTS; i++ )); do echo "file '$WORK/rec-$i.mp4'" >> "$WORK/rec.txt"; done
    ffmpeg -loglevel error -y -f concat -safe 0 -i "$WORK/rec.txt" -c copy "$WORK/rec.mp4"
    rm -f "$WORK"/rec-*.mp4 "$WORK/rec.txt"; REC_PARTS=0
    ffmpeg -loglevel error -y -i "$WORK/rec.mp4" \
        -vf "fps=$GIF_FPS,scale=$GIF_WIDTH:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" \
        "$OUT/$1.gif"
    echo "  $OUT/$1.gif ($(du -k "$OUT/$1.gif" | cut -f1) KB)"
}
wants() { [[ " $SCENES " == *" $1 "* ]]; }

# Tree navigation with the Solution Explorer's own keys: the first click focuses the tree, typing jumps to a node
# (type-to-find), Right expands it
tree_focus() { key ctrl+alt+l; pause 1; click 140 81; }
tree_open() { for name in "$@"; do type_text "$name"; pause 1.2; key Right; pause 1.5; done; }
tree_select() { pause 1.2; type_text "$1"; pause 1.2; }
# The y of the tree row with the given index (0 = the solution): about 20.3 px apart from y=81 (project rows are a
# pixel taller than file rows, so far down the list this is a few pixels off, still inside the row)
row_y() { echo $(( 81 + $1 * 203 / 10 )); }
# HTML5 drag & drop with the mouse: press, move in small steps (Chromium only starts a drag after moves between press
# and release; xdotool's events do start it), rest on the target (the highlight; a collapsed folder expands after
# 0.7 s), release. drag x1 y1 x2 y2 [rest]. Chromium draws the dragged row under the pointer and, with no compositor,
# opaque: grabbed at the row's left edge (x 70) and dropped further right, it does not cover the target's name
drag() {
    xdotool mousemove "$1" "$2" mousedown 1; sleep 0.3
    local i; for i in 1 2 3 4 5 6 7 8; do xdotool mousemove $(( $1 + ($3 - $1) * i / 8 )) $(( $2 + ($4 - $2) * i / 8 )); sleep 0.1; done
    sleep "${5:-1}"; xdotool mouseup 1; sleep 1
}
# Opens Shop.Web's context menu and clicks an entry by its offset below the click (from context-menu.png).
# After Collapse All and opening the solution and src, rows are 20.6 px apart from y=81: the solution, Solution Items,
# src, then src's projects in order.
project_y() {
    local dir="$1" index
    index="$(ls "$SOLUTION/$dir" | sort -f | grep -n -x "$2" | cut -d: -f1)"
    echo $(( 81 + (3 + index - 1) * 206 / 10 ))
}
shop_web_y() { project_y src Shop.Web; }
shop_web_menu() {
    local y; y="$(shop_web_y)"
    tree_focus; tree_open Contoso src; click 165 "$y" 3; pause 1.5; click 280 $(( y + $1 ))
}
# Builds and test runs reopen the panel (at times later in a scene); scenes without it hide it before the shot. Clicking the empty tab bar first takes the focus out of webviews, which
# keep the command palette's keys
close_panel() { click 1300 52; command "View: Hide Panel" 1; }
# The panel's own close button: the command above fails at times while a webview has the focus (a build or test run
# reopened the panel behind the template wizard). With no panel the click lands on empty space
close_panel_button() { click 1570 696; }
# A modal dialog of VS Code (a window of its own, at 0,0 without a window manager, under the cropped title bar): moved
# to the middle of the screen; click_dialog_button <n> clicks the n-th of its two buttons (bottom row, left to right)
dialog_window() { (timeout 10 xdotool search --sync --onlyvisible --name '^(Code - OSS|Visual Studio Code|VSCodium)$' || true) | tail -1; }
# x y width height of a window
window_box() { xdotool getwindowgeometry --shell "$1" | sed -n 's/^\(X\|Y\|WIDTH\|HEIGHT\)=//p' | tr '\n' ' '; }
center_dialog() {
    local w x y dw dh; w="$(dialog_window)"; [ -n "$w" ] || return 0
    read -r x y dw dh <<< "$(window_box "$w")"
    xdotool windowmove "$w" $(( (WIDTH - dw) / 2 )) $(( (HEIGHT - dh) / 3 ))
}
click_dialog_button() {
    local w x y dw dh; w="$(dialog_window)"; [ -n "$w" ] || return 0
    read -r x y dw dh <<< "$(window_box "$w")"
    click $(( x + dw * ($1 * 2 - 1) / 4 )) $(( y + dh - 18 ))
}
# The quick input (command palette, pickers, input boxes) sits in the title bar, which the GIFs crop away: scenes that
# show what is typed into it drag it down (VS Code keeps the place) and put it back at the top afterwards
quick_input_move() {
    key ctrl+shift+p; pause 1
    xdotool mousemove 800 "$1" mousedown 1; sleep 0.3
    local i; for i in 1 2 3 4 5 6; do xdotool mousemove 800 $(( $1 + ($2 - $1) * i / 6 )); sleep 0.1; done
    xdotool mouseup 1; pause 1; key Escape
}
quick_input_down() { quick_input_move 9 150; }
quick_input_up() { quick_input_move 151 5; }
# Every scene starts from the collapsed tree, with no editors and no panel
reset() { command "Collapse All" 2; command "View: Close All Editors" 1; close_panel; }

# --- the sample: a copy of sample/ (Contoso), built ----------------------------------------------------------------

echo "Preparing the sample in $WORK"
cp -r "$REPO/scripts/screenshots/sample" "$WORK/Contoso"
SOLUTION="$WORK/Contoso"
(cd "$SOLUTION" && dotnet build Contoso.slnx -p:EmitCompilerGeneratedFiles=true -v q -nologo >/dev/null)
# Recompile in VS Code, so the warnings come from its build (Error List, tree markers)
touch "$SOLUTION/src/Shop.Core/Orders/Order.cs" "$SOLUTION/src/Shop.Core/Pricing/PriceCalculator.cs"

# --- a throwaway profile ---------------------------------------------------------------------------------------

mkdir -p "$WORK/profile/User" "$WORK/extensions" "$OUT"
[ -n "$CSHARP_EXT" ] && ln -s "$CSHARP_EXT" "$WORK/extensions/"
RUNTIME_EXT="$(ls -d "$HOME"/.vscode-oss/extensions/ms-dotnettools.vscode-dotnet-runtime-* "$HOME"/.vscode/extensions/ms-dotnettools.vscode-dotnet-runtime-* 2>/dev/null | tail -1 || true)"
[ -n "$RUNTIME_EXT" ] && ln -s "$RUNTIME_EXT" "$WORK/extensions/"
cat > "$WORK/profile/User/settings.json" <<EOF
{
  "workbench.colorTheme": "$THEME",
  "workbench.startupEditor": "none",
  "security.workspace.trust.enabled": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.autoCheckUpdates": false,
  "extensions.autoUpdate": false,
  "workbench.tips.enabled": false,
  "git.enabled": false,
  "editor.minimap.enabled": false,
  "chat.disableAIFeatures": true,
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "window.restoreWindows": "none",
  "window.title": "\${rootName}",
  "testing.automaticallyOpenTestResults": "neverOpen",
  "dotnet.server.useOmnisharp": false
}
EOF
# --- VS Code in a virtual display ------------------------------------------------------------------------------

echo "Starting VS Code ($THEME)"
Xvfb "$DISPLAY" -screen 0 "${WIDTH}x${HEIGHT}x24" -nolisten tcp >/dev/null 2>&1 &
XVFB_PID=$!
pause 2
# Webviews stay blank with GPU compositing in Xvfb. dotnet watch (the hot reload scene) opens no browser
DOTNET_WATCH_SUPPRESS_LAUNCH_BROWSER=1 "$CODE" --disable-gpu --user-data-dir="$WORK/profile" --extensions-dir="$WORK/extensions" \
    --extensionDevelopmentPath="$REPO" --disable-workspace-trust --new-window "$SOLUTION" >"$WORK/code.log" 2>&1 &
CODE_PID=$!
pause 20
WINDOW="$(xdotool search --onlyvisible --class code | tail -1)"
# No window manager: size the window by hand
xdotool windowmove "$WINDOW" 0 0 windowsize "$WINDOW" "$WIDTH" "$HEIGHT"
pause 1
xdotool windowfocus "$WINDOW"
# A wider side bar for the tree
key ctrl+alt+l
pause 3
xdotool mousemove 347 500 mousedown 1 mousemove 420 500 mousemove 470 500 mouseup 1
pause 1
key ctrl+shift+b
pause 15

# --- scenes ----------------------------------------------------------------------------------------------------

if wants solution-explorer; then
    echo "Scene: solution-explorer"
    reset
    tree_focus
    tree_open Contoso src Shop.Core Orders
    tree_select Shop.Web; key Right; pause 1.5
    tree_select Pages; key Right; pause 1.5
    tree_select Index.cshtml; key Right; pause 1
    key ctrl+p; type_text "Order.cs"; pause 1.5; key Return; pause 3
    shot solution-explorer
fi

if wants dependencies; then
    echo "Scene: dependencies"
    reset
    tree_focus
    tree_open Contoso src Shop.Core Dependencies Analyzers
    tree_select Shop.Generators; key Right; pause 2
    tree_select Shop.Generators.B; key Right; pause 2
    tree_select Product.Describe; key Return; pause 3
    tree_focus
    tree_open Contoso src Shop.Web Dependencies Packages Microsoft.EntityFrameworkCore.Sqlite
    tree_select Microsoft.EntityFrameworkCore.Sqlite.Core; key Right; pause 2
    close_panel
    shot dependencies
fi

if wants context-menu; then
    echo "Scene: context-menu"
    reset
    tree_focus
    tree_open Contoso src
    click 165 "$(shop_web_y)" 3
    pause 2
    shot context-menu
    key Escape
fi

if wants error-list; then
    echo "Scene: error-list"
    reset
    key ctrl+p; type_text "PriceCalculator.cs"; pause 1.5; key Return; pause 3
    command "Show Error List" 3
    shot error-list
fi

if wants tests; then
    echo "Scene: tests"
    reset
    command "Testing: Focus on Test Explorer View" 3
    command "Test: Run All Tests" 90
    command "Test Results: Focus on Test Results View" 2
    key ctrl+p; type_text "OrderTests.cs"; pause 1.5; key Return; pause 4
    shot tests
fi

if wants nuget; then
    echo "Scene: nuget"
    reset
    shop_web_menu 327
    pause 15
    close_panel
    shot nuget
fi

if wants new-project; then
    echo "Scene: new-project"
    reset
    command "Create New Project..." 20
    # Step 1: search, select a template (its description shows on the right)
    click 700 138; type_text "Razor Pages"; pause 1.5
    click 600 175; pause 1
    close_panel_button
    shot new-project
    # Step 2: double-clicking the template opens "Configure your new project"
    double_click 600 175; pause 2
    shot new-project-configure
    command "View: Close All Editors" 1
fi

if wants publish; then
    echo "Scene: publish"
    reset
    shop_web_menu 541
    pause 5
    close_panel
    shot publish
fi

if wants gif-navigate; then
    echo "Scene: gif-navigate"
    reset
    tree_focus
    record_start
    tree_open Contoso src Shop.Web Pages
    tree_select Index.cshtml; key Right; pause 1.5
    tree_select Index.cshtml.cs; key Return; pause 3
    record_stop solution-explorer
fi

if wants gif-nuget; then
    echo "Scene: gif-nuget"
    reset
    record_start
    shop_web_menu 327
    pause 10
    close_panel
    record_stop nuget
fi

if wants gif-new-project; then
    echo "Scene: gif-new-project"
    reset
    command "Create New Project..." 20
    close_panel_button; pause 2
    record_start
    click 700 138; type_text "Razor Pages"; pause 1.5
    click 600 175; pause 1.5
    double_click 600 175; pause 3
    record_stop new-project
    command "View: Close All Editors" 1
fi

if wants gif-configuration-manager; then
    echo "Scene: gif-configuration-manager"
    reset
    # The scene edits the solution file (x64, Build off); the other scenes get it back as it was
    cp "$SOLUTION/Contoso.slnx" "$WORK/Contoso.slnx.orig"
    record_start
    command "Configuration Manager..." 4
    # Edit Platforms..., add x64 (the platform dropdown appears), then switch Build off for Shop.Worker
    click 720 178; pause 1.5
    click 610 280; type_text "x64"; pause 1; click 999 280; pause 2
    click 1479 536; pause 2
    record_stop configuration-manager
    cp "$WORK/Contoso.slnx.orig" "$SOLUTION/Contoso.slnx"
    command "View: Close All Editors" 1
fi

if wants gif-startup-projects; then
    echo "Scene: gif-startup-projects"
    reset
    # The scene writes a profile (the user file), launch.json and tasks.json of the work copy; the other scenes get them back as they were
    cp "$SOLUTION/.vscode/launch.json" "$WORK/launch.json.orig"
    cp "$SOLUTION/.vscode/tasks.json" "$WORK/tasks.json.orig"
    # Opened before the recording starts: the tab takes a moment to load
    command "Configure Startup Projects..." 4
    record_start
    # Multiple startup projects, then Start for Shop.Web and Shop.Worker, Apply (positions from the tab's layout)
    click 502 195; pause 1.5
    click 965 477; pause 1; click 900 521; pause 1
    click 965 513; pause 1; click 900 561; pause 1
    click 1547 676; pause 3
    # What F5 starts now: the profile is in the picker
    command "Select Startup Profile..." 2
    pause 1; key Escape; pause 1
    record_stop startup-projects
    # Without the profile file the extension falls back to the single project (and rewrites launch.json), then the originals are put back
    rm -f "$SOLUTION"/Contoso.slnLaunch "$SOLUTION"/Contoso.slnLaunch.user
    sleep 3
    cp "$WORK/launch.json.orig" "$SOLUTION/.vscode/launch.json"
    cp "$WORK/tasks.json.orig" "$SOLUTION/.vscode/tasks.json"
    command "View: Close All Editors" 1
fi

if wants gif-attach-to-process; then
    echo "Scene: gif-attach-to-process"
    reset
    # The sample web app runs without the debugger, in its own process group so that stop_app ends dotnet run and the app
    setsid dotnet run --no-build --project "$SOLUTION/src/Shop.Web" --urls http://localhost:5181 >"$WORK/app.log" 2>&1 &
    APP_PID=$!
    pause 8
    record_start
    pause 1
    key ctrl+shift+p; pause 0.8; type_text "Attach to Process"; pause 1.5; key Return; pause 3
    # filtering by the port, then by the project
    type_text "5181"; pause 2
    key ctrl+a; type_text "Shop.Web"; pause 2
    key Escape; pause 1
    record_stop attach-to-process
    stop_app
    command "View: Close All Editors" 1
fi

if wants gif-dev-cert; then
    echo "Scene: gif-dev-cert"
    reset
    # Starts the startup project with its https launch profile; the notification only shows while the machine's HTTPS development
    # certificate is not trusted (nothing in this scene trusts it). launch.json of the work copy is put back afterwards
    cp "$SOLUTION/.vscode/launch.json" "$WORK/launch.json.orig"
    sed -i 's/"launchSettingsProfile": "http"/"launchSettingsProfile": "https"/' "$SOLUTION/.vscode/launch.json"
    sleep 3
    record_start
    pause 1
    command "Start Without Debugging" 1
    pause 9
    record_stop dev-cert
    command "Debug: Stop" 2
    cp "$WORK/launch.json.orig" "$SOLUTION/.vscode/launch.json"
    sleep 3
    command "View: Close All Editors" 1
fi

if wants gif-hot-reload; then
    echo "Scene: gif-hot-reload"
    reset
    # Edits Index.cshtml of the work copy (put back afterwards); dotnet watch runs in the "Shop.Web (watch)" terminal
    cp "$SOLUTION/src/Shop.Web/Pages/Index.cshtml" "$WORK/Index.cshtml.orig"
    key ctrl+p; type_text "Index.cshtml"; pause 1.5; key Return; pause 2
    tree_focus; tree_open Contoso src
    record_start
    pause 1
    # Debug is 292 px below the project row; Start with Hot Reload is the third entry of its submenu
    click 165 "$(shop_web_y)" 3; pause 1.5
    click 280 $(( $(shop_web_y) + 292 )); pause 1.5
    # (the mouse leaves the side bar's edge, which would stay highlighted)
    click 470 $(( $(shop_web_y) + 340 )); xdotool mousemove 1000 400; pause 14
    # The edit in the editor, saved: the terminal reports the hot reload
    click 900 300; key ctrl+g; type_text "8"; key Return; key End; key Left Left Left Left Left
    type_text " to Contoso"; key ctrl+s; pause 8
    record_stop hot-reload
    # Closing the terminal stops dotnet watch and the app
    command "Terminal: Kill the Active Terminal Instance" 5
    cp "$WORK/Index.cshtml.orig" "$SOLUTION/src/Shop.Web/Pages/Index.cshtml"
    for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "[d]otnet-watch|Shop[.]Web/bin" >/dev/null || break; sleep 1; done
    if pgrep -af "[d]otnet-watch|Shop[.]Web/bin"; then echo "  dotnet watch is still running"; else echo "  dotnet watch stopped"; fi
    command "View: Close All Editors" 1
fi

if wants gif-code-cleanup; then
    echo "Scene: gif-code-cleanup"
    reset
    # A messy file in the work copy only (removed again: the other scenes don't know it)
    cat > "$SOLUTION/src/Shop.Core/Pricing/Rounding.cs" <<'CS'
using System;
using System.Text;
using System.Linq;
namespace Shop.Core.Pricing;
public static class Rounding
{
        public static decimal ToCents(decimal price)
        {
              if (price < 0) { return 0; }
          return Math.Round( price , 2 );
        }
   public static string Label(decimal price)
   {
         return $"{ToCents(price)} EUR";
   }
}
CS
    sleep 2
    key ctrl+p; type_text "Rounding.cs"; pause 1.5; key Return; pause 2
    tree_focus; tree_open Contoso src
    record_start
    pause 2
    click 165 "$(project_y src Shop.Core)" 3; pause 1.5
    # Code Cleanup is 527 px below the project row (from the menu's screenshot)
    click 280 $(( $(project_y src Shop.Core) + 527 )); pause 12
    record_stop code-cleanup
    rm -f "$SOLUTION/src/Shop.Core/Pricing/Rounding.cs"
    command "View: Close All Editors" 1
fi

if wants gif-sync-namespaces; then
    echo "Scene: gif-sync-namespaces"
    reset
    # Files with wrong namespaces and an .editorconfig that makes IDE0130 report, in the work copy only (removed
    # again: the other scenes don't know them). The language server needs a moment to load the solution
    cat > "$SOLUTION/.editorconfig" <<'EC'
[*.cs]
dotnet_diagnostic.IDE0130.severity = warning
dotnet_style_namespace_match_folder = true
EC
    cat > "$SOLUTION/src/Shop.Core/Orders/Shipment.cs" <<'CS'
namespace Shop.Core.Legacy;

public record Shipment(string Carrier, decimal Cost);
CS
    cat > "$SOLUTION/src/Shop.Core/Pricing/ShippingCost.cs" <<'CS'
using Shop.Core.Legacy;

namespace Shop.Core.Pricing;

public static class ShippingCost
{
    public static decimal Of(Shipment shipment) => shipment.Cost;
}
CS
    sleep 2
    key ctrl+p; type_text "Shipment.cs"; pause 1.5; key Return; pause 25
    tree_focus; tree_open Contoso src
    record_start
    pause 2
    click 165 "$(project_y src Shop.Core)" 3; pause 1.5
    # Sync Namespaces is 553 px below the project row, under Code Cleanup
    click 280 $(( $(project_y src Shop.Core) + 553 )); pause 3
    # the confirmation: Sync is the default button
    key Return; pause 15
    record_stop sync-namespaces
    rm -f "$SOLUTION/.editorconfig" "$SOLUTION/src/Shop.Core/Orders/Shipment.cs" "$SOLUTION/src/Shop.Core/Pricing/ShippingCost.cs"
    command "File: Save All" 1
    command "View: Close All Editors" 1
fi

if wants gif-show-all-files; then
    echo "Scene: gif-show-all-files"
    # A file the project removes (Legacy/Old.cs, <Compile Remove>), in the work copy only: the file is deleted and the
    # project file put back afterwards, the other scenes don't know them
    cp "$SOLUTION/src/Shop.Core/Shop.Core.csproj" "$WORK/Shop.Core.csproj.orig"
    mkdir -p "$SOLUTION/src/Shop.Core/Legacy"
    printf 'namespace Shop.Core.Legacy;\n\npublic static class Old\n{\n}\n' > "$SOLUTION/src/Shop.Core/Legacy/Old.cs"
    sed -i 's|^</Project>|  <ItemGroup>\n    <Compile Remove="Legacy\\Old.cs" />\n  </ItemGroup>\n\n</Project>|' "$SOLUTION/src/Shop.Core/Shop.Core.csproj"
    sleep 5
    reset
    tree_focus; tree_open Contoso src Shop.Core
    record_start
    pause 2
    # The title bar's Show All Files button: Legacy, bin and obj appear greyed out
    click 395 52; pause 2
    # Legacy is the fourth row below the project (Dependencies, bin, Catalog, Legacy), Old.cs the fifth once it is open
    row_y=$(( $(project_y src Shop.Core) + 80 ))
    click 200 "$row_y"; key Right; pause 1.5
    row_y=$(( row_y + 20 ))
    click 200 "$row_y"; pause 1
    # Include In Project is 137 px below the click (from the menu)
    click 200 "$row_y" 3; pause 1.5
    click 280 $(( row_y + 137 )); pause 3
    # Show All Files off again (bin and obj go, Old.cs is now one row higher), then Exclude From Project in the same slot
    click 395 52; pause 2
    row_y=$(( row_y - 20 ))
    click 200 "$row_y" 3; pause 1.5
    click 280 $(( row_y + 137 )); pause 3
    xdotool mousemove 1000 400; pause 1
    record_stop show-all-files
    rm -rf "$SOLUTION/src/Shop.Core/Legacy"
    cp "$WORK/Shop.Core.csproj.orig" "$SOLUTION/src/Shop.Core/Shop.Core.csproj"
    sleep 3
    command "View: Close All Editors" 1
fi

if wants gif-drag-and-drop; then
    echo "Scene: gif-drag-and-drop"
    reset
    # In the work copy only (put back afterwards): a solution folder "tools" to drag Shop.Generators into, and a C# file
    # at the top of Shop.Core to drag into Pricing
    cp "$SOLUTION/Contoso.slnx" "$WORK/Contoso.slnx.orig"
    sed -i 's|^</Solution>|  <Folder Name="/tools/" />\n</Solution>|' "$SOLUTION/Contoso.slnx"
    sleep 3
    tree_focus; tree_open Contoso src Shop.Core
    # Created while Shop.Core is open: the tree only sees new files of a project it shows (and then lists them once
    # MSBuild evaluated the project again)
    printf 'namespace Shop.Core;\n\npublic record Coupon(string Code, decimal Percent);\n' > "$SOLUTION/src/Shop.Core/Coupon.cs"
    sleep 5
    # Rows now: 0 Contoso, 1 Solution Items, 2 src, 3 Shop.Core, 4 Dependencies, 5 Catalog, 6 Orders, 7 Pricing,
    # 8 Coupon.cs, 9 Shop.Generators, 10 Shop.Web, 11 Shop.Worker, 12 tests, 13 tools
    record_start
    pause 1
    # Coupon.cs onto Pricing (it opens while the pointer rests on it); the namespace question's default button is
    # Update Namespace, which opens the file
    drag 70 "$(row_y 8)" 330 "$(row_y 7)" 1.5; pause 1.5
    key Return; pause 2.5
    # Pricing is open now: 8 Discounts, 9 Coupon.cs, 10 PriceCalculator.cs, 11 Shop.Generators, ..., 15 tools.
    # Shop.Generators onto the tools solution folder, which is opened afterwards to show it
    drag 70 "$(row_y 11)" 330 "$(row_y 15)"; pause 2
    click 200 "$(row_y 14)"; key Right; pause 2
    xdotool mousemove 1000 400; pause 1
    record_stop drag-and-drop
    command "File: Save All" 1
    command "View: Close All Editors" 1
    cp "$WORK/Contoso.slnx.orig" "$SOLUTION/Contoso.slnx"
    rm -f "$SOLUTION/src/Shop.Core/Coupon.cs" "$SOLUTION/src/Shop.Core/Pricing/Coupon.cs"
    sleep 3
fi

if wants gif-central-packages; then
    echo "Scene: gif-central-packages"
    # The work copy moves to Central Package Management: the versions into Directory.Packages.props (an override in
    # Shop.Core.NUnitTests, a global package), the Version attributes out of the projects. Put back and restored
    # afterwards: the other scenes don't know it
    (cd "$SOLUTION" && find src tests -name '*.csproj' -print0 | tar cf "$WORK/csproj.tar" --null -T -)
    cat > "$SOLUTION/Directory.Packages.props" <<'XML'
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="coverlet.collector" Version="6.0.4" />
    <PackageVersion Include="Microsoft.CodeAnalysis.CSharp" Version="4.14.0" />
    <PackageVersion Include="Microsoft.EntityFrameworkCore.Sqlite" Version="10.0.13" />
    <PackageVersion Include="Microsoft.Extensions.Hosting" Version="10.0.11" />
    <PackageVersion Include="Microsoft.NET.Test.Sdk" Version="17.14.1" />
    <PackageVersion Include="NUnit" Version="4.3.2" />
    <PackageVersion Include="NUnit.Analyzers" Version="4.7.0" />
    <PackageVersion Include="NUnit3TestAdapter" Version="5.0.0" />
    <PackageVersion Include="Riok.Mapperly" Version="4.3.1" />
    <PackageVersion Include="xunit" Version="2.9.3" />
    <PackageVersion Include="xunit.runner.visualstudio" Version="3.1.4" />
    <PackageVersion Include="xunit.v3" Version="3.2.2" />
  </ItemGroup>
  <ItemGroup>
    <GlobalPackageReference Include="Microsoft.SourceLink.GitHub" Version="8.0.0" />
  </ItemGroup>
</Project>
XML
    find "$SOLUTION/src" "$SOLUTION/tests" -name '*.csproj' -exec sed -i -E '/<PackageReference /s/ Version="[^"]*"//' {} \;
    sed -i 's|<PackageReference Include="Microsoft.NET.Test.Sdk"|& VersionOverride="17.14.0"|' "$SOLUTION/tests/Shop.Core.NUnitTests/Shop.Core.NUnitTests.csproj"
    (cd "$SOLUTION" && dotnet restore Contoso.slnx -v q -nologo >/dev/null)
    # The project watchers re-evaluate the projects
    sleep 8
    reset
    command "Notifications: Clear All Notifications" 1
    # The C# extension warns while it reloads the edited projects: do not disturb (warnings and messages stay hidden,
    # the confirmation is a dialog) until the end of the scene
    command "Notifications: Toggle Do Not Disturb Mode" 1
    tree_focus
    record_start
    # Dependencies > Packages: the override and the global package
    tree_open Contoso tests Shop.Core.NUnitTests Dependencies Packages
    pause 2
    # Installed: Microsoft.SourceLink.GitHub (selected first) carries the global badge and says where it is set
    command "Open NuGet Package Manager for Solution" 15
    pause 3
    # Filtered to Microsoft.NET.Test.Sdk and selected: the note names Directory.Packages.props and the override, the
    # project list shows v17.14.1 and v17.14.0 (override)
    click 1000 126; type_text "Test.Sdk"; pause 2
    click 700 235; pause 4
    # Shop.Core.XUnit2Tests checked (the last project row), the newest version (the dropdown's first entry), Set for This
    # Project Only: a VersionOverride in that project, no question
    click 965 551; pause 1.5
    click 1295 615; pause 1.5
    click 1240 639; pause 1.5
    click 1437 649; xdotool mousemove 760 700; pause 7
    # Consolidate (the fourth tab), Select all, the Consolidate button: the confirmation lists the edits
    click 784 88; pause 4
    click 507 156; pause 1
    click 1524 126; pause 1
    center_dialog; pause 4
    click_dialog_button 2; pause 10
    xdotool mousemove 1000 700; pause 2
    record_stop central-packages
    click 1300 52; command "Notifications: Toggle Do Not Disturb Mode" 1
    command "Notifications: Clear All Notifications" 1
    rm -f "$SOLUTION/Directory.Packages.props"
    (cd "$SOLUTION" && tar xf "$WORK/csproj.tar")
    (cd "$SOLUTION" && dotnet restore Contoso.slnx -v q -nologo >/dev/null)
    sleep 5
    command "View: Close All Editors" 1
fi

if wants gif-grpc; then
    echo "Scene: gif-grpc"
    # Shop.Web gets a gRPC reference from a URL in the work copy; the project file is put back, Protos deleted and the
    # packages restored afterwards
    cp "$SOLUTION/src/Shop.Web/Shop.Web.csproj" "$WORK/Shop.Web.csproj.orig"
    reset
    command "Notifications: Clear All Notifications" 1
    quick_input_down
    tree_focus; tree_open Contoso src
    y="$(shop_web_y)"
    record_start
    pause 0.5
    # Add Service Reference...: the last item of the second group
    click 165 "$y" 3; pause 1.5; click 280 $(( y + 177 ))
    pause 1.5
    # The kind of service, the source, the URL, what to generate (Both comes first in a web project)
    type_text "gRPC"; pause 0.8; key Return; pause 1.5
    type_text "Enter URL"; pause 0.8; key Return; pause 1.5
    type_text "https://raw.githubusercontent.com/grpc/grpc-dotnet/master/examples/Greeter/Proto/greet.proto"; pause 1; key Return; pause 1.5
    key Return; pause 4
    # The download, Grpc.AspNetCore with its restore and the evaluation are left out of the GIF
    record_pause
    for _ in $(seq 120); do grep -q 'Grpc.AspNetCore' "$SOLUTION/src/Shop.Web/Shop.Web.csproj" && break; sleep 1; done
    sleep 12
    # The local copy made older, so Update has something to replace
    printf '// An older copy\n' >> "$SOLUTION/src/Shop.Web/Protos/greet.proto"
    record_start
    # Shop.Web open: Connected Services is its first row, greet.proto (Both) the first row in it
    click 200 "$y"; key Right; pause 1.5
    click 200 $(( y + 20 )); key Right; pause 1.5
    click 200 $(( y + 40 )); pause 1
    # Update gRPC Reference: second item, below Open and a separator
    click 200 $(( y + 40 )) 3; pause 1.5
    click 280 $(( y + 40 + 56 )); pause 4
    # Remove gRPC Reference: third item, the confirmation's Remove button
    click 200 $(( y + 40 )) 3; pause 1.5
    click 280 $(( y + 40 + 88 )); pause 0.3
    center_dialog; pause 2.5
    click_dialog_button 2; pause 3
    xdotool mousemove 1000 400; pause 1
    record_stop grpc
    command "Notifications: Clear All Notifications" 1
    quick_input_up
    cp "$WORK/Shop.Web.csproj.orig" "$SOLUTION/src/Shop.Web/Shop.Web.csproj"
    rm -rf "$SOLUTION/src/Shop.Web/Protos"
    (cd "$SOLUTION" && dotnet restore Contoso.slnx -v q -nologo >/dev/null)
    sleep 5
    command "View: Close All Editors" 1
fi

echo "Done: $OUT"
