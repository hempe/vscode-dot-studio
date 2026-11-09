# Enhanced refactorings

The C# extension's language server offers most refactorings in the lightbulb menu (Ctrl+.): rename, extract method, generate constructor and many more. This extension adds the ones Visual Studio and Rider have and the server lacks. They appear in the same menu, next to the server's own.

Refactorings that need choices ask them in a form in the editor area, like a dialog: it opens as a tab in front of your file. **Extract** (or Enter) applies, **Cancel**, **Esc** or closing the tab drops the refactoring and changes nothing.

## Hiding refactorings you never use

The entries are in the lightbulb and the Refactor menu (Ctrl+.). The setting `shinobi.refactorings.disabled` (Settings > Extensions > Shinobi .NET Studio > Refactorings) lists the ones to hide; it is a list with a drop-down per row, and a change applies at once, without a reload. A hidden refactoring is not offered and the C# server is not asked about it; its command stays registered, so a key binding to it still works.

The entries sit in the group of the Refactor menu that fits them, so `editor.action.codeAction` key bindings can ask for a group (`{ "kind": "refactor.move" }`): **Extract** (`refactor.extract`) for Extract Interface, Extract Members to Partial Class, Extract Superclass, Extract Class and the checked Extract Method and Local Function; **Rewrite** (`refactor.rewrite`) for Use Base Type and Convert Abstract Class ↔ Interface; **Move** (`refactor.move`) for Pull Members Up and Push Members Down, and `refactor.move.namespace` for Move Type to Namespace.

## What is added, what is planned

| Refactoring | Visual Studio | Here |
|---|---|---|
| Extract Interface with a dialog (members, name, new file) | Yes | ✅ [Added](#extract-interface) |
| Extract Members to Partial Class (pick members, they move to `Type.<Name>.cs`) | No (Rider) | ✅ [Added](#extract-members-to-partial-class) |
| Extract Superclass (pick members, per member "make abstract"; the result is compiled before it is applied) | Yes (Extract Base Class) | ✅ [Added](#extract-superclass) |
| Extract Method / Extract Local Function with the compiler's check (the server's own makes uncompilable `out` parameters) | Yes | ✅ [Added](#extract-method-checked) |
| Rename, Generate Constructor, Encapsulate Field, Use file-scoped namespace, Use primary constructor, Move Type to File, ... | Yes | ➖ The C# server offers them in Ctrl+. already; not repeated here |
| Pull Members Up (pick members and the base class or interface, with a warning for members that use what stays) | Yes | ✅ [Added](#pull-members-up) |
| Use Base Type Where Possible (a checkbox of Extract Interface and Extract Superclass, and an action on a type's name) | No (Rider) | ✅ [Added](#use-base-type-where-possible) |
| Push Members Down (pick members and the derived types, or leave an abstract declaration) | No (Rider) | ✅ [Added](#push-members-down) |
| Convert Abstract Class ↔ Interface | No (Rider) | ✅ [Added](#convert-abstract-class--interface) |
| Extract Class (members go to a new class the type delegates to) | No (Rider) | ✅ [Added](#extract-class) |
| Move Type to Namespace (pick the namespace) | Yes | ✅ [Added](#move-type-to-namespace) |
| Change Signature (add, remove, reorder, rename, retype parameters and update the callers) | Yes | ✅ [Added](#change-signature) |
| Extract Interface: generic constraints of the type | Yes | ✅ Added: the interface gets the type's `where` clauses |

They were built in the order of their cost, cheapest first ([Phase 45 in the history](history.md#phase-45-refactorings-inside-the-c-server-done-2026-11-04-released-in-030)). A refactoring that writes a new type or file (Extract Interface, Extract Superclass, Extract Class, Extract Members to Partial Class) stops with a message when a type of that name or a file of that name exists already, instead of writing over it. They run inside the C# extension's language server, Microsoft's (`ms-dotnettools.csharp`) or the Open VSX one (`muhammad-sammy.csharp`); a check runs every night against the newest versions of both, the pre-release included, so a change of the server is found before it reaches you. Every refactoring here follows the same pattern: the lightbulb entry opens the form, the confirm button applies, Cancel or Esc changes nothing. A refactoring the C# server gets itself later is dropped from here. Ideas go to the [roadmap](roadmap.md) (Phase 45).

## Extract Interface

Put the cursor on the name of a class, struct or record and press Ctrl+. > **Extract interface (choose members)...** (the server's own *Extract interface...* next to it takes every public member without asking).

The form has:
- **New interface name:** `I` plus the type's name; it must be a C# identifier.
- **Generate into:** a **new file** next to the type (`IOrder.cs`, with the usings and the namespace of the type's file; the default, like Visual Studio) or **the same file**, above the type.
- **Select public members to form interface:** the type's public instance methods, properties (indexers too) and events, all checked; **Select all** and **Deselect all**. A preview shows the interface as it will be written, in the colours of your colour theme.

On Extract the interface is created and the type gets it as a base type (`public class Order : IOrder`). Both files are saved (the edited one only when it had no other unsaved changes), so a build sees the new file at once; Ctrl+Z in the type's editor undoes the base type. The new file only holds the usings the interface needs. If the new file already exists you are told and nothing changes. In a project with several target frameworks (`<TargetFrameworks>`) the C# server does not notice new files by itself (the types that use them keep "could not be found" until a reload); the extension touches the project file so the server reads the project again.

The interface of a generic type has the type's type parameters and their `where` constraints (`IBox<T> where T : class, IComparable<T>`), and the new file the usings the constraints need.

Not covered yet: members with explicit interface implementations or `internal` visibility are not listed.

## Extract Members to Partial Class

Put the cursor on the name of a class, struct or record and press Ctrl+. > **Extract members to partial class...** to split a big type into files without changing it.

The form has the **name of the part** (`Part` by default; the file is `Order.Part.cs`, next to the type, in the same namespace and namespace style), the members to move (fields, constructors, methods, properties, events and nested types, each with its kind; **Select all** and **Deselect all**), and a preview of the new part with the bodies folded.

**Move** makes the type `partial` (and the types around it when it is nested), takes the chosen members out of the file together with their comments and attributes, and writes them into the new file with the `using`s they need. Nothing else changes: no references are touched, the type is the same type. Both files are saved. The new part repeats `partial`, the keyword, the name and the type parameters of the type; accessibility, base types and constraints stay with the first part.

## Extract Superclass

Put the cursor on the name of a class and press Ctrl+. > **Extract superclass (choose members)...** The server's own *Extract base class...* stays in the menu; it takes no choices and can produce code that does not compile (on a partial class with an interface it rewrote a whole file with dozens of duplicate `using` lines). Prefer this one.

The form has the **name of the base class** (`<Type>Base`), **Generate into** (a new file next to the type, or the same file above it), and the members to move up (none are checked at first). Methods and properties have an **abstract** box: the base class then only declares the member abstract and the type keeps its body as an `override`. A preview shows the base class.

What it does:
- the base class takes the type's old base class (`Foo : Old` becomes `Foo : FooBase` and `FooBase : Old`), the type keeps its interfaces (`Foo : FooBase, IDisposable`), type parameters and their constraints are repeated, it is `abstract` when a member is declared abstract, and the usings it needs are copied;
- a **private** member that the type (or another part of it) still uses becomes `protected`, so do private accessors (`{ get; private set; }`); private members that only the moved members use stay private;
- a member that uses members that stay behind (`_count` in `Inc()`) cannot reach them from the base class: the form warns and **Move them too** checks what they use, also in turn; the confirm button stays off until that is settled.

What it refuses, with the reason, and never generates half of:
- structs, records and static classes are not offered; a **nested** class is refused (the base class would have to be nested too);
- a class that is **partial** works when no *other* part names a base class (the type keeps `: Base` on the part you extract from; members of this part only are listed, the other parts may use what moves, they are checked); otherwise the message names the part;
- a base class without a constructor without arguments, and constructors that call `base(...)` with arguments: the new base class would need constructors that pass them on, which is not supported yet;
- a member that uses something declared in another part of the type cannot move.

**The result is compiled first** (a fork of the solution in the language server: the changed file and the new one): when the edit would add compiler errors, nothing is applied and a dialog lists the first ones. The same check runs for Extract Interface and Extract Members to Partial. Both files are saved after a successful extraction, as for the other refactorings.

## Extract Method (checked)

Select statements or an expression and press Ctrl+. > **Extract method (checked)...** or **Extract local function (checked)...**, next to the server's own *Extract method* and *Extract local function*. It uses the server's own edit (name `NewMethod`, parameters, placement and the rename afterwards stay the server's) and checks it before it is applied.

Why: the server makes a variable that the selection assigns only on some paths an `out` parameter and does not assign it in the new method, so the result does not compile (CS0177). The typical selection is a condition with `out var` or a pattern variable behind `&&`:

```csharp
if (this.map.TryGetValue(name, out var forId)
    && forId != null
    && forId.TryGetValue(langKey ?? string.Empty, out var item))
```

becomes `NewMethod(name, langKey, out item)` whose body returns the condition and never assigns `item` when `forId` is null. The checked entry compiles the server's edit on a copy of the solution; for every CS0177 on an `out` parameter of the new method it adds `item = default;` as the first line of that method (`default(T)` in projects below C# 7.1), compiles again and applies the result only when it adds no compiler errors.

What it does not repair: `ref` and `out` in `async` methods, iterators and lambdas (CS1988 and friends), and anything else that does not compile. Nothing is applied then, and a dialog lists the first compiler errors; use the server's entry and fix the result by hand, or change the selection. The entries show where the server offers its own (a selection the server cannot extract gets none), and only for the server's English titles.

## Pull Members Up

Put the cursor on a member's name (or on the class's name) and press Ctrl+. > **Pull members up...**. It is offered for classes that have a base class or an interface declared in this solution's source (a base class from a NuGet package or the framework cannot be edited and is not listed).

The form has:
- **Pull up to:** the base classes (nearest first) and the interfaces the class implements, with the file and project each is declared in. A target in another file or project is edited there.
- **Members to pull up:** the class's methods, properties, events, fields and nested types; the member the cursor was on is checked at the start. For a **class** target a method or property has an **abstract** box: the base class then only declares it abstract (and becomes abstract itself when it was not) and the class keeps the body as an `override`. For an **interface** target the class keeps its implementation and the interface gets the signature; members an interface cannot have (non-public, static, fields, nested types) are off with the reason.
- A preview of what the target gets.

What it does for a class target: the chosen members move (with their comments) to the end of the base class, the usings they need that the base class's file lacks are added there, a `private` member the class still uses becomes `protected` (also private accessors), and an abstract member makes the base class abstract. A member that uses members that stay in the class (`_barks` in `Bark()`) cannot reach them from the base class: the form warns and **Pull them up too** checks what they use, also in turn; the button stays off until that is settled.

What it refuses, with the reason, and never half-applies:
- a member the target already has (the same name and, for methods, the same parameter types);
- generic base classes and interfaces are not offered (their type arguments would have to be mapped);
- a member that uses something declared in another part of a partial class.

**The result is compiled first**, in the projects it touches (the class's, the target's): an edit that adds compiler errors is not applied and a dialog lists the first ones. That is also how the cases the refactoring does not rewrite show up: pulling an abstract member while another class derives from the base class without implementing it lists "does not implement inherited abstract member" for each (CS0534), and making a base class abstract where it is created with `new` lists CS0144; implement the member there first, or pull it up as a normal member. The changed files are saved when they had no other unsaved changes, so a build sees them at once.

Not covered yet: generating `throw new NotImplementedException()` stubs in the other derived classes, moving a member between classes in two projects when the base project does not reference what the member uses (the compile check then refuses it).

## Push Members Down

Rider's refactoring, the opposite of Pull Members Up. Put the cursor on a class's name or on one of its members and press Ctrl+. > **Push members down...**. It is offered for classes that have a class derived from them in this solution's source (directly derived classes only; generic classes, on either side, are not supported).

The form has:
- **Push down to:** the derived classes with their file and project, all checked. A class in another file or project is edited there.
- **Leave an abstract declaration** (off): the class keeps an abstract declaration of each method and property and the checked derived classes get the body as an `override` (the class becomes abstract); fields and nested types always move.
- **Members to push down:** the class's members; the one the cursor was on is checked at the start. When a member that leaves is used by one that stays (`Report()` uses `Energy`), the form warns, and **Push it down too** checks the users, also in turn; with the abstract declaration left nothing is lost and no warning shows.
- A preview of what the derived classes get.

What it does: the chosen members are copied (with their comments) to the end of each chosen derived class, the usings they need that the derived class's file lacks are added there, and the members leave the class (or become abstract declarations). A `private` member of the class that a pushed member uses stays and becomes `protected`, so the derived class can reach it. It refuses a member a chosen derived class has already (the same name and, for methods, the same parameter types).

**The result is compiled first**, in every project it touches. What the refactoring does not rewrite shows up as errors and nothing is applied: code that used the member through the class (`animal.Rest()`, CS1061), a derived class that was not chosen and now misses an abstract member (CS0534), an interface the class implemented with the member (CS0535). Push down to those classes as well, or implement the member there first.

## Extract Class

Rider's refactoring. Put the cursor on a class's name and press Ctrl+. > **Extract class (choose members)...**. It is offered for classes that are not generic, nested, partial or static, and have no primary constructor.

The form has:
- **Name of the new class** (`<Type>Helper` at the start) and **Generate into:** a new file next to the type, or the same file above it.
- **Members to move:** methods, properties and fields (nothing is checked at the start). Not offered, with the reason shown: `virtual`, `abstract`, `override`, `sealed`, `new`, `extern` and `partial` members, members that implement an interface, events, indexers, nested types, `init` accessors, and members that use `this` or `base` themselves.
- A warning when a picked member uses a `private` or `protected` member that stays: the new class could not reach it. **Move it too** checks it (and what it uses in turn). `public` and `internal` members that stay are reached through a reference to the type.
- A preview of the new class.

What it does:
- The chosen members move to the new class. The type gets a `private readonly` field of it (`_orderHelper`); a field initializer when the moved members need nothing of the type, otherwise the type's constructors create it with `new OrderHelper(this)` (a type without a constructor gets one) and the new class keeps the owner in `_owner`, through which its members reach what stays (`_owner.Id`). If every moved member is `static`, the new class is `static` and there is no field.
- Uses of the moved members inside the type go through the field (`Bump()` and `this.Bump()` become `_orderHelper.Bump()`).
- Moved members that were `public`, `protected` or `internal` stay in the type as one-line forwarding members (`public int Total => _orderHelper.Total;`, a field becomes a forwarding property), so no caller anywhere changes; moved `private` members just leave. In the new class `protected` and `internal` members become `internal`, and a `private` member stays `private` unless the type still uses it (then it becomes `internal`).
- The usings the moved code needs go to the new file.

**The result is compiled first.** What it does not rewrite shows up as errors and nothing is applied: a `readonly` field that the type assigns in its constructor (CS0191), another instance of the type reaching a moved `private` member (`other._count`), a public field that others pass as `ref` or `out`. Move those members as well, or change that code first.

Not covered: attributes of members that stay as forwarding members are dropped (they move with the member), and a constructor with an expression body is refused when the field has to be created in it.

## Move Type to Namespace

Visual Studio's *Move to namespace*, with the namespace of your choice (the C# server's own *Change namespace* cannot take one). Put the cursor on the name of a class, struct, record, interface or enum and press Ctrl+. > **Move type to namespace...**.

The form shows the namespace the type is in and an input for the new one; the namespaces your solution's source declares are suggested while you type. **Move** is off until the name is a valid, different namespace.

What it does:
- **The type:** its namespace declaration is renamed (a file-scoped namespace, or a block that holds only this type). From a block with other types it moves to a block of its own at the end of the file; a type in a file without a namespace gets `namespace X;`. The file stays where it is: use *Move type to file* or *Sync namespaces* to match the folder.
- **What it used:** the type keeps the usings of what it used from its old namespace and the ones around it (`using App;` for `Root` when `App.Old.Order` moves to `Shop.Orders`).
- **Everywhere it is used** (also in other projects): a place that no longer sees the new namespace gets `using <namespace>;` (callers of extension methods of a moved static class too); a name written with its namespace (`App.Old.Order`) gets the new one. Places that already see the namespace (inside it or an enclosing one, a `using` or a global using) are left alone.
- **A namespace that is empty now:** `using App.Old;` in the files that used it is changed to the new namespace, or removed when the file needs nothing from it.

It refuses nested types, namespaces declared inside another namespace, partial types with several parts, and a type that shares a file-scoped namespace (or a file without namespace) with other types: move it to its own file first.

**The result is compiled first** in every project it touches, and nothing is applied when it would add errors (a name that is now ambiguous, for one).

## Change Signature

Visual Studio's *Change Signature*. Put the cursor on the name of a method, a constructor or a local function, in its declaration or in a call, and press Ctrl+. > **Change signature...** (in the **Rewrite** group). The entry is not offered for methods declared in a library.

![Change Signature of a method: two parameters swapped, the call in another project follows](images/change-signature.gif)

The form lists the parameters in a table: move one up or down, rename it, give it another type, **Remove** it (a removed row stays visible and can be restored) or **Add parameter**. A new parameter needs a name, a type and either what every call passes for it, or a default value (it is then optional and the calls leave it out). A preview shows the new declaration; **Change Signature** is off while the list has a problem (a name that is no identifier or used twice, a required parameter behind an optional one, a `params` parameter that is not last) or nothing changed.

What it does:
- **The declaration, and the methods that must stay equal:** the methods it overrides or implements, and those that override or implement it (also in other files and projects), get the same parameters. The form lists them. A method that overrides or implements one from a library is refused.
- **Every call:** the arguments follow the parameters (reordered, removed, the value for a new one). Where a parameter is left out in the middle (an optional one, a new one with a default value), the arguments behind it get their names. Named arguments stay named, and are renamed with the parameter. Constructor calls (`new T(...)`, `new(...)`, `: base(...)`, `: this(...)`) and calls of an extension method, in both forms (`x.Pad(1)` and `Pad(x, 1)`), change as well.
- **A renamed parameter:** its uses in the body, the `nameof`s, the named arguments and `<paramref>` in the documentation.
- **The documentation:** the `<param>` tags follow the new order, the tag of a removed parameter goes, a new parameter gets an empty tag.

Limits: the first parameter (`this`) of an extension method stays where it is; the return type, `ref`/`out`/`in` modifiers and attributes are not edited; a reference that is not a call (a method group such as `list.Select(Add)`) is left as it is and counted in the message, the compiler check then lists what no longer fits. Removing a parameter removes the arguments too, and with them whatever side effects they had; reordering changes the order the arguments are evaluated in.

**The result is compiled first** in every project it touches, and nothing is applied when it would add errors (an argument whose type no longer fits the new parameter type, for one).

## Convert Abstract Class ↔ Interface

Rider's refactoring. Put the cursor on the name of an abstract class or an interface and press Ctrl+. > **Convert abstract class to interface...** (or **Convert interface to abstract class...**, the title follows the direction).

The form says what changes and lists the classes of this solution's source that derive from the class or implement the interface; they are rewritten too:
- **Abstract class → interface:** the declaration becomes `interface`, `public`, `abstract` and `virtual` leave the members, and the classes that derive from it lose `override` on what implements its members. Members with a body can only stay as default interface members (C# 8): the form asks for it with a checkbox, and without it nothing is converted.
- **Interface → abstract class:** the members become `public abstract` and the classes that implement it get `override` on what implemented its members and name it first in their base list.
- The type keeps its name; rename it (F2) to follow your naming. Every use of it stays valid.

What it refuses, with the reasons listed and the form not opened: an abstract class with state (fields, automatic properties, events with their own field), constructors or finalizers, nested types, operators, static, `new`, `sealed`, `extern` or non-public members, explicit interface implementations, or a base class; an interface that extends other interfaces or has static or non-public members; a class that already has another base class, and structs, records or other interfaces that use the type.

**The result is compiled first** in every project it touches; if it would not compile nothing is changed and the errors are listed.

## Use Base Type Where Possible

Rider's refactoring: parameters, local variables and private fields that name a type use one of its base classes or interfaces instead, where everything done with them exists there. It is a checkbox in the forms of **Extract Interface** and **Extract Superclass** ("Use IOrder instead of Order where possible", off by default), and an action of its own: put the cursor on the name of a class, struct, record or interface and press Ctrl+. > **Use base type where possible...**. The action is offered for types that have a base class or an interface declared in this solution's source. The form lists them with how many declarations each would be used in ("4 places, 2 in the parameters of public methods"); a target that would change nothing is off.

What it changes: the type name in the declaration of a **parameter** (of a method, constructor or local function), a **local variable** (`Order x = ...`, not `var`) or a **private field**. It leaves the code alone where the value is used in a way the base type does not allow:
- a member only the type has is used (`order.Count` when the interface lacks it), or an extension method on the type;
- the value is cast, tested with `is` or `as`, passed by `ref`, `out` or `in`, returned, enumerated, locked or awaited;
- it is passed on to a parameter or variable of the type, unless that one changes as well (a chain `A(o) → B(o)` changes together or not at all);
- the type defines operators or conversions, or is generic (the standalone action says so).

Methods that cannot change their signature are skipped: overrides, virtual and abstract methods, interface implementations, extension methods and partial methods. Properties, return types, generic arguments (`List<Order>`) and lambda parameters are not changed. A parameter of a method other code can call changes its signature (a caller still compiles; a library that other assemblies were built against needs them rebuilt): the summary says how many.

**The result is compiled first.** What the analysis accepted but does not compile (an overload that now has the same signature, a conversion it did not see) is found by compiling halves of the changes on a copy of the solution; the offending ones are left out, and when none compiles nothing is changed. After it ran, a message says how many places use the new type now.

## Keeping file and type names in step

Like Visual Studio, a file and the type named after it are renamed together, in all three ways to rename:
- **In the Solution Explorer** (F2 on a `.cs` file): asks whether to rename the type of the same name and all references to it, then renames the file.
- **In VS Code's Explorer** (or any other rename of the file): once the file is renamed, the same question is asked (a message, not a dialog).
- **F2 on the type's name in the editor:** the rename runs as it always does; when the file is named after the type, you are then asked whether to rename the file to the new name too. If a file with that name exists already, the file keeps its name and you are told. This works through the F2 key (a `.NET` key binding for C# files); the rename from the context menu or the command palette is VS Code's own and does not ask.

A file that only moves, a rename to a name that is no identifier and files that declare no type of that name are left alone. The type's rename is the C# server's, so it needs the C# extension.

## Needs

A C# extension that has the language server (`ms-dotnettools.csharp` or `muhammad-sammy.csharp`, with its Roslyn server, not OmniSharp). The refactorings are a small .NET assembly (`out/server-extension/Shinobi.Refactorings.dll`, built with the extension) that the C# extension hands to its server; nothing else is installed.
