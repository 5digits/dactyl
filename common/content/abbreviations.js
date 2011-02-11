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

var AbbrevHive = Class("AbbrevHive", Contexts.Hive, {
    init: function init(group) {
        init.superapply(this, arguments);
        this._store = {};
    },

    get empty() !values(this._store).nth(util.identity, 0),

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
    clear: function (modes) {
        for (let mode in values(modes)) {
            for (let abbr in values(this._store[mode]))
                abbr.removeMode(mode);
            delete this._store[mode];
        }
    }
});

var Abbreviations = Module("abbreviations", {
    init: function () {

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

    get: deprecated("group.abbrevs.get", { get: function get() this.user.closure.get }),
    set: deprecated("group.abbrevs.set", { get: function set() this.user.closure.set }),
    remove: deprecated("group.abbrevs.remove", { get: function remove() this.user.closure.remove }),
    removeAll: deprecated("group.abbrevs.clear", { get: function removeAll() this.user.closure.clear }),

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
            return this.hives.map(function (h) h.get(mode, match[2] || match[4] || match[6])).nth(util.identity, 0);
        return null;
    },

    /**
     * Lists all abbreviations matching *modes* and *lhs*.
     *
     * @param {Array} modes List of modes.
     * @param {string} lhs The LHS of the abbreviation.
     */
    list: function (modes, lhs) {
        let hives = contexts.allGroups.abbrevs.filter(function (h) !h.empty);

        function abbrevs(hive)
            hive.merged.filter(function (abbr) (abbr.inModes(modes) && abbr.lhs.indexOf(lhs) == 0));

        let list = <table>
                <tr highlight="Title">
                    <td/>
                    <td style="padding-right: 1em;">Mode</td>
                    <td style="padding-right: 1em;">Abbrev</td>
                    <td style="padding-right: 1em;">Replacement</td>
                </tr>
                <col style="min-width: 6em; padding-right: 1em;"/>
                {
                    template.map(hives, function (hive) let (i = 0)
                        <tr style="height: .5ex;"/> +
                        template.map(abbrevs(hive), function (abbrev)
                            <tr>
                                <td highlight="Title">{!i++ ? hive.name : ""}</td>
                                <td>{abbrev.modeChar}</td>
                                <td>{abbrev.lhs}</td>
                                <td>{abbrev.rhs}</td>
                            </tr>) +
                        <tr style="height: .5ex;"/>)
                }
                </table>;

        // TODO: Move this to an ItemList to show this automatically
        if (list.*.length() === list.text().length() + 2)
            dactyl.echomsg("No abbreviations found");
        else
            commandline.commandOutput(list);
    }

}, {
}, {
    contexts: function initContexts(dactyl, modules, window) {
        update(Abbreviations.prototype, {
            hives: contexts.Hives("abbrevs", AbbrevHive),
            user: contexts.hives.abbrevs.user
        });
    },
    completion: function () {
        completion.abbreviation = function abbreviation(context, modes, group) {
            group = group || abbreviations.user;
            let fn = modes ? function (abbr) abbr.inModes(modes) : util.identity;
            context.keys = { text: "lhs" , description: "rhs" };
            context.completions = group.merged.filter(fn);
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
                        args["-group"].add(modes, lhs, rhs);
                    }
                }, {
                    completer: function (context, args) {
                        if (args.length == 1)
                            return completion.abbreviation(context, modes, args["-group"]);
                        else if (args["-javascript"])
                            return completion.javascript(context);
                    },
                    hereDoc: true,
                    literal: 1,
                    options: [
                        contexts.GroupFlag("abbrevs"),
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
                        for ([, abbr] in Iterator(abbreviations.user.merged))
                        if (abbr.modesEqual(modes))
                    ]
                });

            commands.add([ch + "una[bbreviate]"],
                "Remove an abbreviation" + modeDescription,
                function (args) {
                    let lhs = args.literalArg;
                    if (!lhs)
                        return dactyl.echoerr("E474: Invalid argument");
                    if (!args["-group"].remove(modes, lhs))
                        return dactyl.echoerr("E24: No such abbreviation");
                }, {
                    argCount: "1",
                    completer: function (context) completion.abbreviation(context, modes, args["-group"]),
                    literal: 0,
                    options: [contexts.GroupFlag("abbrevs")]
                });

            commands.add([ch + "abc[lear]"],
                "Remove all abbreviations" + modeDescription,
                function (args) { args["-group"].clear(modes); },
                {
                    argCount: "0",
                    options: [contexts.GroupFlag("abbrevs")]
                });
        }

        addAbbreviationCommands([modes.INSERT, modes.COMMAND_LINE], "", "");
        addAbbreviationCommands([modes.INSERT], "i", "insert");
        addAbbreviationCommands([modes.COMMAND_LINE], "c", "command line");
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
