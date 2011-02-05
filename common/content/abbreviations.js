// Copyright (c) 2006-2009 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2010 by anekos <anekos@snca.net>
// Copyright (c) 2010-2011 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

var Abbreviation = Class("Abbreviation", {
    init: function (modes, lhs, rhs) {
        this.modes = modes.sort();
        this.lhs = lhs;
        this.rhs = rhs;
    },

    equals: function (other) this.lhs == other.lhs && this.rhs == other.rhs,

    expand: function (editor) String(callable(this.rhs) ? this.rhs(editor) : this.rhs),

    modesEqual: function (modes) array.equals(this.modes, modes),

    inMode: function (mode) this.modes.some(function (_mode) _mode == mode),

    inModes: function (modes) modes.some(function (mode) this.inMode(mode), this),

    removeMode: function (mode) {
        this.modes = this.modes.filter(function (m) m != mode).sort();
    },

    get modeChar() Abbreviation.modeChar(this.modes)
}, {
    modeChar: function (_modes) {
        let result = array.uniq(_modes.map(function (m) m.char)).join("");
        if (result == "ci")
            result = "!";
        return result;
    }
});

var Abbreviations = Module("abbreviations", {
    init: function () {
        this._store = {};

        // (summarized from Vim's ":help abbreviations")
        //
        // There are three types of abbreviations.
        //
        // full-id: Consists entirely of keyword characters.
        //          ("foo", "g3", "-1")
        //
        // end-id: Ends in a keyword character, but all other
        //         are not keyword characters.
        //         ("#i", "..f", "$/7")
        //
        // non-id: Ends in a non-keyword character, but the
        //         others can be of any type other than space
        //         and tab.
        //         ("def#", "4/7$")
        //
        // Example strings that cannot be abbreviations:
        //         "a.b", "#def", "a b", "_$r"
        //
        // For now, a keyword character is anything except for \s, ", or '
        // (i.e., whitespace and quotes). In Vim, a keyword character is
        // specified by the 'iskeyword' setting and is a much less inclusive
        // list.
        //
        // TODO: Make keyword definition closer to Vim's default keyword
        //       definition (which differs across platforms).

        let params = { // This is most definitely not Vim compatible.
            keyword:    /[^\s"']/,
            nonkeyword: /[   "']/
        };

        this._match = util.regexp(<><![CDATA[
            (^ | \s | <nonkeyword>) (<keyword>+             )$ | // full-id
            (^ | \s | <keyword>   ) (<nonkeyword>+ <keyword>)$ | // end-id
            (^ | \s               ) (\S* <nonkeyword>       )$   // non-id
        ]]></>, "", params);
        this._check = util.regexp(<><![CDATA[
            ^ (?:
              <keyword>+              | // full-id
              <nonkeyword>+ <keyword> | // end-id
              \S* <nonkeyword>          // non-id
            ) $
        ]]></>, "", params);
    },

    /**
     * Adds a new abbreviation.
     *
     * @param {Abbreviation} abbr The abbreviation to add.
     */
    add: function (abbr) {
        if (!(abbr instanceof Abbreviation))
            abbr = Abbreviation.apply(null, arguments);

        for (let [, mode] in Iterator(abbr.modes)) {
            if (!this._store[mode])
                this._store[mode] = {};
            this._store[mode][abbr.lhs] = abbr;
        }
    },

    /**
     * Returns the abbreviation with *lhs* in the given *mode*.
     *
     * @param {Mode} mode The mode of the abbreviation.
     * @param {string} lhs The LHS of the abbreviation.
     */
    get: function (mode, lhs) {
        let abbrevs = this._store[mode];
        return abbrevs && set.has(abbrevs, lhs) ? abbrevs[lhs] : null;
    },

    /**
     * Returns the abbreviation for the given *mode* if *text* matches the
     * abbreviation expansion criteria.
     *
     * @param {Mode} mode The mode to search.
     * @param {string} text The string to test against the expansion criteria.
     *
     * @returns {Abbreviation}
     */
    match: function (mode, text) {
        let match = this._match.exec(text);
        if (match)
            return abbreviations.get(mode, match[2] || match[4] || match[6]);
        return null;
    },

    /**
     * @property {Abbreviation[]} The list of the abbreviations merged from
     *     each mode.
     */
    get merged() {
        let result = [];
        let lhses = [];
        let modes = [mode for (mode in this._store)];

        for (let [, abbrevs] in Iterator(this._store))
            lhses = lhses.concat([key for (key in abbrevs)]);
        lhses.sort();
        lhses = array.uniq(lhses);

        for (let [, lhs] in Iterator(lhses)) {
            let exists = {};
            for (let [, abbrevs] in Iterator(this._store)) {
                let abbr = abbrevs[lhs];
                if (abbr && !exists[abbr.rhs]) {
                    exists[abbr.rhs] = 1;
                    result.push(abbr);
                }
            }
        }

        return result;
    },

    /**
     * Lists all abbreviations matching *modes* and *lhs*.
     *
     * @param {Array} modes List of modes.
     * @param {string} lhs The LHS of the abbreviation.
     */
    list: function (modes, lhs) {
        let list = this.merged.filter(function (abbr) (abbr.inModes(modes) && abbr.lhs.indexOf(lhs) == 0));

        if (!list.length)
            dactyl.echomsg("No abbreviations found");
        else if (list.length == 1) {
            let head = list[0];
            dactyl.echo(head.modeChar + "  " + head.lhs + "   " + head.rhs, commandline.FORCE_SINGLELINE); // 2 spaces, 3 spaces
        }
        else {
            list = list.map(function (abbr) [abbr.modeChar, abbr.lhs, abbr.rhs]);
            list = template.tabular(["", "LHS", "RHS"], [], list);
            commandline.echo(list, commandline.HL_NORMAL, commandline.FORCE_MULTILINE);
        }
    },

    /**
     * Remove the specified abbreviations.
     *
     * @param {Array} modes List of modes.
     * @param {string} lhs The LHS of the abbreviation.
     * @returns {boolean} Did the deleted abbreviation exist?
     */
    remove: function (modes, lhs) {
        let result = false;
        for (let [, mode] in Iterator(modes)) {
            if ((mode in this._store) && (lhs in this._store[mode])) {
                result = true;
                this._store[mode][lhs].removeMode(mode);
                delete this._store[mode][lhs];
            }
        }
        return result;
    },

    /**
     * Removes all abbreviations specified in *modes*.
     *
     * @param {Array} modes List of modes.
     */
    removeAll: function (modes) {
        for (let [, mode] in modes) {
            if (!(mode in this._store))
                return;
            for (let [, abbr] in this._store[mode])
                abbr.removeMode(mode);
            delete this._store[mode];
        }
    }
}, {
}, {
    completion: function () {
        completion.abbreviation = function abbreviation(context, modes) {
            let fn = modes ? function (abbr) abbr.inModes(modes) : util.identity;
            context.keys = { text: "lhs" , description: "rhs" };
            context.completions = abbreviations.merged.filter(fn);
        };
    },

    commands: function () {
        function addAbbreviationCommands(modes, ch, modeDescription) {
            modes.sort();
            modeDescription = modeDescription ? " in " + modeDescription + " mode" : "";

            commands.add([ch ? ch + "a[bbreviate]" : "ab[breviate]"],
                "Abbreviate a key sequence" + modeDescription,
                function (args) {
                    let [lhs, rhs] = args;
                    dactyl.assert(!args.length || abbreviations._check.test(lhs),
                                  "E474: Invalid argument");

                    if (!rhs)
                        abbreviations.list(modes, lhs || "");
                    else {
                        if (args["-javascript"])
                            rhs = contexts.bindMacro({ literalArg: rhs }, "-javascript", ["editor"]);
                        abbreviations.add(modes, lhs, rhs);
                    }
                }, {
                    completer: function (context, args) {
                        if (args.length == 1)
                            return completion.abbreviation(context, modes);
                        else if (args["-javascript"])
                            return completion.javascript(context);
                    },
                    hereDoc: true,
                    literal: 1,
                    options: [
                        {
                            names: ["-javascript", "-js", "-j"],
                            description: "Expand this abbreviation by evaluating its right-hand-side as JavaScript"
                        }
                    ],
                    serialize: function () [
                        {
                            command: this.name,
                            arguments: [abbr.lhs],
                            literalArg: abbr.rhs,
                            options: callable(abbr.rhs) ? {"-javascript": null} : {}
                        }
                        for ([, abbr] in Iterator(abbreviations.merged))
                        if (abbr.modesEqual(modes))
                    ]
                });

            commands.add([ch + "una[bbreviate]"],
                "Remove an abbreviation" + modeDescription,
                function (args) {
                    let lhs = args.literalArg;
                    if (!lhs)
                        return dactyl.echoerr("E474: Invalid argument");
                    if (!abbreviations.remove(modes, lhs))
                        return dactyl.echoerr("E24: No such abbreviation");
                }, {
                    argCount: "1",
                    completer: function (context) completion.abbreviation(context, modes),
                    literal: 0
                });

            commands.add([ch + "abc[lear]"],
                "Remove all abbreviations" + modeDescription,
                function () { abbreviations.removeAll(modes); },
                { argCount: "0" });
        }

        addAbbreviationCommands([modes.INSERT, modes.COMMAND_LINE], "", "");
        addAbbreviationCommands([modes.INSERT], "i", "insert");
        addAbbreviationCommands([modes.COMMAND_LINE], "c", "command line");
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
