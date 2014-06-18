// Copyright (c) 2008-2014 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

defineModule("highlight", {
    exports: ["Highlight", "Highlights", "highlight"],
    require: ["services", "util"]
});

lazyRequire("styles", ["Styles", "styles"]);
lazyRequire("template", ["template"]);

var Highlight = Struct("class", "selector", "sites",
                       "defaultExtends", "defaultValue",
                       "value", "extends", "agent",
                       "base", "baseClass", "style");
Highlight.liveProperty = function (name, prop) {
    this.prototype.__defineGetter__(name, function () this.get(name));
    this.prototype.__defineSetter__(name, function (val) {
        if (isObject(val) && name !== "style") {
            if (isArray(val))
                val = Array.slice(val);
            else
                val = update({}, val);
            Object.freeze(val);
        }
        this.set(name, val);

        if (name === "value" || name === "extends")
            for (let h in highlight)
                if (h.extends.indexOf(this.class) >= 0)
                    h.style.css = h.css;

        this.style[prop || name] = this[prop || name];
        if (this.onChange)
            this.onChange();
    });
}
Highlight.liveProperty("agent");
Highlight.liveProperty("extends", "css");
Highlight.liveProperty("value", "css");
Highlight.liveProperty("selector", "css");
Highlight.liveProperty("sites");
Highlight.liveProperty("style", "css");

Highlight.defaultValue("baseClass", function () /^(\w*)/.exec(this.class)[0]);

Highlight.defaultValue("selector", function () highlight.selector(this.class));

Highlight.defaultValue("sites", function ()
    this.base ? this.base.sites
              : ["resource://dactyl*", "dactyl:*", "file://*"].concat(
                    highlight.styleableChrome));

Highlight.defaultValue("style", function ()
    styles.system.add("highlight:" + this.class, this.sites, this.css, this.agent, true));

Highlight.defaultValue("defaultExtends", () => []);
Highlight.defaultValue("defaultValue", () => "");
Highlight.defaultValue("extends", function () this.defaultExtends);
Highlight.defaultValue("value", function () this.defaultValue);

update(Highlight.prototype, {
    get base() this.baseClass != this.class && highlight.highlight[this.baseClass] || null,

    get bases() array.compact(this.extends.map(name => highlight.get(name))),

    get inheritedCSS() {
        if (this.gettingCSS)
            return "";
        try {
            this.gettingCSS = true;
            return this.bases.map(b => b.cssText.replace(/;?\s*$/, "; ")).join("");
        }
        finally {
            this.gettingCSS = false;
        }
    },

    get css() this.selector + "{" + this.cssText + "}",

    get cssText() this.inheritedCSS + this.value,

    toString: function () "Highlight(" + this.class + ")\n\t" +
        [k + ": " + String(v).quote() for ([k, v] in this)] .join("\n\t")
});

/**
 * A class to manage highlighting rules.
 *
 * @author Kris Maglione <maglione.k@gmail.com>
 */
var Highlights = Module("Highlight", {
    init: function () {
        this.highlight = {};
        this.loaded = {};
    },

    keys: function keys() Object.keys(this.highlight).sort(),

    __iterator__: function () values(this.highlight).sort((a, b) => String.localeCompare(a.class, b.class))
                                                    .iterValues(),

    _create: function _create(agent, args) {
        let obj = Highlight.apply(Highlight, args);

        if (!isArray(obj.sites))
            obj.set("sites", obj.sites.split(","));
        if (!isArray(obj.defaultExtends))
            obj.set("defaultExtends", obj.defaultExtends.split(","));
        obj.set("agent", agent);

        obj.set("defaultValue", Styles.append("", obj.get("defaultValue")));

        let old = this.highlight[obj.class];
        this.highlight[obj.class] = obj;
        // This *must* come before any other property changes.
        if (old) {
            obj.selector = old.selector;
            obj.style = old.style;
        }

        if (/^[[>+: ]/.test(args[1]))
            obj.selector = this.selector(obj.class) + args[1];
        else if (args[1])
            obj.selector = this.selector(args[1].replace(/^,/, ""));

        if (old && old.value != old.defaultValue)
            obj.value = old.value;

        if (!old && obj.base && obj.base.style.enabled)
            obj.style.enabled = true;
        else
            this.loaded.__defineSetter__(obj.class, function () {
                Object.defineProperty(this, obj.class, {
                    value: true,
                    configurable: true,
                    enumerable: true,
                    writable: true
                });

                if (obj.class === obj.baseClass)
                    for (let h in highlight)
                        if (h.baseClass === obj.class)
                            this[h.class] = true;
                obj.style.enabled = true;
            });
        return obj;
    },

    get: function get(k) this.highlight[k],

    set: function set(key, newStyle, force, append, extend) {
        let [, class_, selectors] = key.match(/^([a-zA-Z_-]+)(.*)/);

        let highlight = this.highlight[key] || this._create(false, [key]);

        let bases = extend || highlight.extends;
        if (append) {
            newStyle = Styles.append(highlight.value || "", newStyle);
            bases = highlight.extends.concat(bases);
        }

        if (/^\s*$/.test(newStyle))
            newStyle = null;
        if (newStyle == null && extend == null) {
            if (highlight.defaultValue == null && highight.defaultExtends.length == 0) {
                highlight.style.enabled = false;
                delete this.loaded[highlight.class];
                delete this.highlight[highlight.class];
                return null;
            }
            newStyle = highlight.defaultValue;
            bases = highlight.defaultExtends;
        }

        highlight.set("value", newStyle || "");
        highlight.extends = array.uniq(bases, true);
        if (force)
            highlight.style.enabled = true;
        this.highlight[highlight.class] = highlight;
        return highlight;
    },

    /**
     * Clears all highlighting rules. Rules with default values are
     * reset.
     */
    clear: function clear() {
        for (let [k, v] in Iterator(this.highlight))
            this.set(k, null, true);
    },

    /**
     * Highlights a node with the given group, and ensures that said
     * group is loaded.
     *
     * @param {Node} node
     * @param {string} group
     */
    highlightNode: function highlightNode(node, group, applyBindings) {
        node.setAttributeNS(NS, "highlight", group);

        let groups = group.split(" ");
        for (let group of groups)
            this.loaded[group] = true;

        if (applyBindings)
            for (let group of groups) {
                if (applyBindings.bindings && group in applyBindings.bindings)
                    applyBindings.bindings[group](node, applyBindings);
                else if (group in template.bindings)
                    template.bindings[group](node, applyBindings);
            }
    },

    /**
     * Gets a CSS selector given a highlight group.
     *
     * @param {string} class
     */
    selector: function selector(class_)
        class_.replace(/(^|[>\s])([A-Z][\w-]+)\b/g,
            (m, n1, hl) => {
                if (this.highlight[hl] && this.highlight[hl].class != class_)
                    return n1 + this.highlight[hl].selector;
                return n1 + "[dactyl|highlight~=" + hl + "]";
            }),

    groupRegexp: util.regexp(literal(function () /*
        ^
        (\s* (?:\S|\s\S)+ \s+)
        \{ ([^}]*) \}
        \s*
        $
    */$), "gmx"),
    sheetRegexp: util.regexp(literal(function () /*
        ^\s*
        !? \*?
             (?P<group>    (?:[^;\s]|\s[^;\s])+ )
        (?:; (?P<selector> (?:[^;\s]|\s[^;\s])+ )? )?
        (?:; (?P<sites>    (?:[^;\s]|\s[^;\s])+ )? )?
        (?:; (?P<extends>  (?:[^;\s]|\s[^;\s])+ )? )?
        \s*  (?P<css>      .*)
        $
    */$), "x"),
    // </css>

    /**
     * Bulk loads new CSS rules, in the format of,
     *
     *   Rules     ::= Rule | Rule "\n" Rule
     *   Rule      ::= Bang? Star? MatchSpec Space Space+ Css
     *               | Comment
     *   Comment   ::= Space* "//" *
     *   Bang      ::= "!"
     *   Star      ::= "*"
     *   MatchSpec ::= Class
     *               | Class ";" Selector
     *               | Class ";" Selector ";" Sites
     *               | Class ";" Selector ";" Sites ";" Extends
     *   CSS       ::= CSSLine | "{" CSSLines "}"
     *   CSSLines  ::= CSSLine | CSSLine "\n" CSSLines
     *
     * Where Class is the name of the sheet, Selector is the CSS
     * selector for the style, Sites is the comma-separated list of site
     * filters to apply the style to.
     *
     * If Selector is not provided, it defaults to [dactyl|highlight~={Class}].
     * If it is provided and begins with any of "+", ">" or " ", it is
     * appended to the default.
     *
     * If Sites is not provided, it defaults to the chrome documents of
     * the main application window, dactyl help files, and any other
     * dactyl-specific documents.
     *
     * If Star is provided, the style is applied as an agent sheet.
     *
     * The new styles are lazily activated unless Bang or *eager* is
     * provided.
     *
     * @param {string} css The rules to load. See {@link Highlights#css}.
     * @param {boolean} eager When true, load all provided rules immediately.
     */
    loadCSS: function loadCSS(css, eager) {
        String.replace(css, /\\\n/g, "")
              .replace(this.groupRegexp, (m, m1, m2) => (m1 + " " + m2.replace(/\n\s*/g, " ")))
              .split("\n").filter(s => (/\S/.test(s) && !/^\s*\/\//.test(s)))
              .forEach(function (highlight) {

            let bang = eager || /^\s*!/.test(highlight);
            let star = /^\s*!?\*/.test(highlight);
            highlight = this._create(star, this.sheetRegexp.exec(highlight).slice(1));
            if (bang)
                highlight.style.enabled = true;
       }, this);
       for (let h in this)
           h.style.css = h.css;
    }
}, {
}, {
    commands: function initCommands(dactyl, modules) {
        const { autocommands, commands, completion, CommandOption, config, io } = modules;

        let lastScheme;
        commands.add(["colo[rscheme]"],
            "Load a color scheme",
            function (args) {
                let scheme = args[0];
                if (lastScheme)
                    lastScheme.unload();

                if (scheme == "default")
                    highlight.clear();
                else {
                    lastScheme = modules.io.sourceFromRuntimePath(["colors/" + scheme + "." + config.fileExtension]);
                    dactyl.assert(lastScheme, _("command.colorscheme.notFound", scheme));
                }
                autocommands.trigger("ColorScheme", { name: scheme });
            },
            {
                argCount: "1",
                completer: function (context) completion.colorScheme(context)
            });

        commands.add(["hi[ghlight]"],
            "Set the style of certain display elements",
            function (args) {
                let style = literal(function () /*
                    ;
                    display: inline-block !important;
                    position: static !important;
                    margin: 0px !important; padding: 0px !important;
                    width: 3em !important; min-width: 3em !important; max-width: 3em !important;
                    height: 1em !important; min-height: 1em !important; max-height: 1em !important;
                    overflow: hidden !important;
                */$);
                let clear = args[0] == "clear";
                if (clear)
                    args.shift();

                let [key, css] = args;
                let modify = css || clear || args["-append"] || args["-link"];

                if (!modify && /&$/.test(key))
                    [clear, modify, key] = [true, true, key.replace(/&$/, "")];

                dactyl.assert(!(clear && css), _("error.trailingCharacters"));

                if (!modify)
                    modules.commandline.commandOutput(
                        template.tabular(["Key", "Sample", "Link", "CSS"],
                            ["padding: 0 1em 0 0; vertical-align: top; max-width: 16em; overflow: hidden;",
                             "text-align: center"],
                            ([h.class,
                              ["span", { style: "text-align: center; line-height: 1em;" + h.value + style }, "XXX"],
                              template.map(h.extends, s => template.highlight(s), ","),
                              template.highlightRegexp(h.value, /\b[-\w]+(?=:)|\/\*.*?\*\//g,
                                                       match => ["span", { highlight: match[0] == "/" ? "Comment" : "Key" }, match])
                             ]
                             for (h in highlight)
                             if (!key || h.class.indexOf(key) > -1))));
                else if (!key && clear)
                    highlight.clear();
                else if (key)
                    highlight.set(key, css, clear, "-append" in args, args["-link"]);
                else
                    util.assert(false, _("error.invalidArgument"));
            },
            {
                // TODO: add this as a standard highlight completion function?
                completer: function (context, args) {
                    // Complete a highlight group on :hi clear ...
                    if (args.completeArg > 0 && args[0] == "clear")
                        args.completeArg = args.completeArg > 1 ? -1 : 0;

                    if (args.completeArg == 0)
                        completion.highlightGroup(context);
                    else if (args.completeArg == 1) {
                        let hl = highlight.get(args[0]);
                        if (hl)
                            context.completions = [
                                [hl.value, _("option.currentValue")],
                                [hl.defaultValue || "", _("option.defaultValue")]
                            ];
                        context.fork("css", 0, completion, "css");
                    }
                },
                hereDoc: true,
                literal: 1,
                options: [
                    { names: ["-append", "-a"], description: "Append new CSS to the existing value" },
                    {
                        names: ["-link", "-l"],
                        description: "Link this group to another",
                        type: CommandOption.LIST,
                        completer: function (context, args) {
                            let group = args[0] && highlight.get(args[0]);
                            if (group)
                                context.fork("extra", 0, this, context => [
                                     [String(group.extends), _("option.currentValue")],
                                     [String(group.defaultExtends) || "", _("option.defaultValue")]
                                ]);
                            context.fork("groups", 0, completion, "highlightGroup");
                        }
                    }
                ],
                serialize: function () [
                    {
                        command: this.name,
                        arguments: [v.class],
                        literalArg: v.value,
                        options: {
                            "-link": v.extends.length ? v.extends : undefined
                        }
                    }
                    for (v in Iterator(highlight))
                    if (v.value != v.defaultValue)
                ]
            });
    },
    completion: function initCompletion(dactyl, modules) {
        const { completion, config, io } = modules;

        completion.colorScheme = function colorScheme(context) {
            let extRe = RegExp("\\." + config.fileExtension + "$");

            context.title = ["Color Scheme", "Runtime Path"];
            context.keys = { text: f => f.leafName.replace(extRe, ""),
                             description: ".parent.path" };
            context.completions =
                array.flatten(
                        io.getRuntimeDirectories("colors").map(
                            dir => dir.readDirectory()
                                      .filter(file => extRe.test(file.leafName))))
                     .concat([
                        { leafName: "default", parent: { path: /*L*/"Revert to builtin colorscheme" } }
                     ]);

        };

        completion.highlightGroup = function highlightGroup(context) {
            context.title = ["Highlight Group", "Value"];
            context.completions = [[v.class, v.value] for (v in highlight)];
        };
    },
    javascript: function initJavascript(dactyl, modules, window) {
        modules.JavaScript.setCompleter(["get", "set"].map(m => highlight[m]),
            [ (context, obj, args) => Iterator(highlight.highlight) ]);
        modules.JavaScript.setCompleter(["highlightNode"].map(m => highlight[m]),
            [ null, (context, obj, args) => Iterator(highlight.highlight) ]);
    }
});

// catch(e){dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack);}

endModule();

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
