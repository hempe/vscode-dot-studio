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
SCENES="${SCENES:-solution-explorer dependencies context-menu error-list tests nuget new-project publish gif-navigate gif-nuget gif-new-project gif-configuration-manager gif-startup-projects gif-code-cleanup gif-sync-namespaces}"
GIF_FPS=8
GIF_WIDTH=960
DISPLAY_NUMBER=97
WIDTH=1600
HEIGHT=1000

WORK="$(mktemp -d /tmp/shinobi-shots-XXXX)"
export DISPLAY=":$DISPLAY_NUMBER"
XVFB_PID=""
CODE_PID=""
cleanup() {
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
# away, the result is docs/images/<name>.gif (palette per file, so the colours stay close to the screen)
FFMPEG_PID=""
record_start() {
    ffmpeg -loglevel error -y -f x11grab -framerate 15 -video_size "${WIDTH}x${HEIGHT}" -i "$DISPLAY" \
        -vf "crop=${WIDTH}:$((HEIGHT - 36)):0:36" -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p "$WORK/rec.mp4" &
    FFMPEG_PID=$!
    sleep 1
}
record_stop() {
    kill -INT "$FFMPEG_PID"; wait "$FFMPEG_PID" 2>/dev/null || true; FFMPEG_PID=""
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
# Webviews stay blank with GPU compositing in Xvfb
"$CODE" --disable-gpu --user-data-dir="$WORK/profile" --extensions-dir="$WORK/extensions" \
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

echo "Done: $OUT"
