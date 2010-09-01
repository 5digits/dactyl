// Copyright (c) 2008-2010 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

Components.utils.import("resource://dactyl/base.jsm");
defmodule("highlight", this, {
    exports: ["Highlight", "Highlights", "highlight"],
    require: ["services", "styles"],
    use: ["template"]
});

const Highlight = Struct("class", "selector", "filter", "default", "value", "base");

Highlight.defaultValue("filter", function ()
    this.base ? this.base.filter :
    ["chrome://dactyl/*",
     "dactyl:*",
     "file://*"].concat(highlight.styleableChrome).join(","));
Highlight.defaultValue("selector", function () highlight.selector(this.class));
Highlight.defaultValue("value", function () this.default);
Highlight.defaultValue("base", function () {
    let base = /^(\w*)/.exec(this.class)[0];
    return (base != this.class && base in highlight.highlight) ? highlight.highlight[base] : null;
});
Highlight.prototype.toString = function ()
    "Highlight(" + this.class + ")\n\t"
    + [k + ": " + String.quote(v) for ([k, v] in this)]
        .join("\n\t");

/**
 * A class to manage highlighting rules. The parameters are the
 * standard parameters for any {@link Storage} object.
 *
 * @author Kris Maglione <maglione.k@gmail.com>
 */
const Highlights = Module("Highlight", {
    init: function () {
        this.highlight = {};
    },

    keys: function keys() Object.keys(this.highlight).sort(),

    __iterator__: function () values(this.highlight),

    get: function (k) this.highlight[k],
    set: function (key, newStyle, force, append) {
        let [, class_, selectors] = key.match(/^([a-zA-Z_-]+)(.*)/);

        if (!(class_ in this.highlight))
            return "Unknown highlight keyword: " + class_;

        let style = this.highlight[key] || Highlight(key);
        styles.removeSheet(true, style.selector);

        if (append)
            newStyle = (style.value || "").replace(/;?\s*$/, "; " + newStyle);
        if (/^\s*$/.test(newStyle))
            newStyle = null;
        if (newStyle == null) {
            if (style.default == null) {
                delete this.highlight[style.class];
                styles.removeSheet(true, style.selector);
                return null;
            }
            newStyle = style.default;
            force = true;
        }

        let css = newStyle.replace(/(?:!\s*important\s*)?(?:;?\s*$|;)/g, "!important;")
                          .replace(";!important;", ";", "g"); // Seeming Spidermonkey bug
        if (!/^\s*(?:!\s*important\s*)?;*\s*$/.test(css)) {
            css = style.selector + " { " + css + " }";

            let error = styles.addSheet(true, "highlight:" + style.class, style.filter, css, true);
            if (error)
                return error;
        }
        style.value = newStyle;
        this.highlight[style.class] = style;
        return null;
    },

    /**
     * Gets a CSS selector given a highlight group.
     *
     * @param {string} class
     */
    selector: function (class_) {
        let [, hl, rest] = class_.match(/^(\w*)(.*)/);
        let pattern = "[dactyl|highlight~=" + hl + "]"
        if (this.highlight[hl] && this.highlight[hl].class != class_)
            pattern = this.highlight[hl].selector;
        return pattern + rest;
    },

    /**
     * Clears all highlighting rules. Rules with default values are
     * reset.
     */
    clear: function () {
        for (let [k, v] in Iterator(this.highlight))
            this.set(k, null, true);
    },

    /**
     * Bulk loads new CSS rules.
     *
     * @param {string} css The rules to load. See {@link Highlights#css}.
     */
    loadCSS: function (css) {
        css.replace(/^(\s*\S*\s+)\{((?:.|\n)*?)\}\s*$/gm, function (_, _1, _2) _1 + " " + _2.replace(/\n\s*/g, " "))
           .split("\n").filter(function (s) /\S/.test(s))
           .forEach(function (style) {
               style = Highlight.apply(Highlight,
                   Array.slice(style.match(/^\s*((?:[^,\s]|\s\S)+)(?:,((?:[^,\s]|\s\S)+)?)?(?:,((?:[^,\s]|\s\S)+))?\s*(.*)$/),
                               1));
               if (/^[>+ ]/.test(style.selector))
                   style.selector = this.selector(style.class) + style.selector;

               let old = this.highlight[style.class];
               this.highlight[style.class] = style;
               if (old && old.value != old.default)
                   style.value = old.value;
           }, this);
        for (let [class_, hl] in Iterator(this.highlight))
            if (hl.value == hl.default)
                this.set(class_);
    }
}, {
}, {
    commands: function (dactyl, modules) {
        const commands = modules.commands;
        commands.add(["colo[rscheme]"],
            "Load a color scheme",
            function (args) {
                let scheme = args[0];

                if (scheme == "default")
                    highlight.clear();
                else
                    dactyl.assert(modules.io.sourceFromRuntimePath(["colors/" + scheme + ".vimp"]),
                        "E185: Cannot find color scheme " + scheme);
                modules.autocommands.trigger("ColorScheme", { name: scheme });
            },
            {
                argCount: "1",
                completer: function (context) completion.colorScheme(context)
            });

        commands.add(["hi[ghlight]"],
            "Set the style of certain display elements",
            function (args) {
                let style = <![CDATA[
                    ;
                    display: inline-block !important;
                    position: static !important;
                    margin: 0px !important; padding: 0px !important;
                    width: 3em !important; min-width: 3em !important; max-width: 3em !important;
                    height: 1em !important; min-height: 1em !important; max-height: 1em !important;
                    overflow: hidden !important;
                ]]>;
                let clear = args[0] == "clear";
                if (clear)
                    args.shift();

                let [key, css] = args;
                dactyl.assert(!(clear && css), "E488: Trailing characters");

                if (!css && !clear)
                    modules.commandline.commandOutput(
                        template.tabular(["Key", "Sample", "CSS"],
                            ["padding: 0 1em 0 0; vertical-align: top",
                             "text-align: center"],
                            ([h.class,
                              <span style={"text-align: center; line-height: 1em;" + h.value + style}>XXX</span>,
                              template.highlightRegexp(h.value, /\b[-\w]+(?=:)/g)]
                                for (h in highlight)
                                if (!key || h.class.indexOf(key) > -1))));
                else if (!key && clear)
                    highlight.clear();
                else {
                    let error = highlight.set(key, css, clear, "-append" in args);
                    if (error)
                        dactyl.echoerr(error);
                }
            },
            {
                // TODO: add this as a standard highlight completion function?
                completer: function (context, args) {
                    // Complete a highlight group on :hi clear ...
                    if (args.completeArg > 0 && args[0] == "clear")
                        args.completeArg = args.completeArg > 1 ? -1 : 0;

                    if (args.completeArg == 0)
                        context.completions = [[v.class, v.value] for (v in highlight)];
                    else if (args.completeArg == 1) {
                        let hl = highlight.get(args[0]);
                        if (hl)
                            context.completions = [[hl.value, "Current Value"], [hl.default || "", "Default Value"]];
                    }
                },
                hereDoc: true,
                literal: 1,
                options: [{ names: ["-append", "-a"], description: "Append new CSS to the existing value" }],
                serialize: function () [
                    {
                        command: this.name,
                        arguments: [k],
                        literalArg: v
                    }
                    for ([k, v] in Iterator(highlight))
                    if (v.value != v.default)
                ]
            });
    },
    completion: function (dactyl, modules) {
        const completion = modules.completion;
        completion.colorScheme = function colorScheme(context) {
            context.title = ["Color Scheme", "Runtime Path"];
            context.keys = { text: function (f) f.leafName.replace(/\.vimp$/, ""), description: ".parent.path" };
            context.completions = util.Array.flatten(
                modules.io.getRuntimeDirectories("colors").map(
                    function (dir) dir.readDirectory().filter(
                        function (file) /\.vimp$/.test(file.leafName))))

        };

        completion.highlightGroup = function highlightGroup(context) {
            context.title = ["Highlight Group", "Value"];
            context.completions = [[v.class, v.value] for (v in highlight)];
        };
    }
});

// catch(e){dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack);}

endmodule();

// vim:se fdm=marker sw=4 ts=4 et ft=javascript:
