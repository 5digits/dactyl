// Copyright (c) 2006-2009 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2010 by anekos <anekos@snca.net>
// Copyright (c) 2010-2014 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

/**
 * A user-defined input mode binding of a typed string to an automatically
 * inserted expansion string.
 *
 * Abbreviations have a left-hand side (LHS) whose text is replaced by that of
 * the right-hand side (RHS) when triggered by an Input mode expansion key.
 * E.g. an abbreviation with a LHS of "gop" and RHS of "Grand Old Party" will
 * replace the former with the latter.
 *
 * @param {[Mode]} modes The modes in which this abbreviation is active.
 * @param {string} lhs The left hand side of the abbreviation; the text to
 *     be replaced.
 * @param {string|function(nsIEditor):string} rhs The right hand side of
 *     the abbreviation; the replacement text. This may either be a string
 *     literal or a function that will be passed the appropriate nsIEditor.
 * @private
 */
var Abbreviation = Class("Abbreviation", {
    init: function (modes, lhs, rhs) {
        this.modes = modes.sort();
        this.lhs = lhs;
        this.rhs = rhs;
    },

    /**
     * Returns true if this abbreviation's LHS and RHS are equal to those in
     * *other*.
     *
     * @param {Abbreviation} other The abbreviation to test.
     * @returns {boolean} The result of the comparison.
     */
    equals: function (other) this.lhs == other.lhs && this.rhs == other.rhs,

    /**
     * Returns the abbreviation's expansion text.
     *
     * @param {nsIEditor} editor The editor in which abbreviation expansion is
     *     occurring.
     * @returns {string}
     */
    expand: function (editor) String(callable(this.rhs) ? this.rhs(editor) : this.rhs),

    /**
     * Returns true if this abbreviation is defined for all *modes*.
     *
     * @param {[Mode]} modes The modes to test.
     * @returns {boolean} The result of the comparison.
     */
    modesEqual: function (modes) array.equals(this.modes, modes),

    /**
     * Returns true if this abbreviation is defined for *mode*.
     *
     * @param {Mode} mode The mode to test.
     * @returns {boolean} The result of the comparison.
     */
    inMode: function (mode) this.modes.some(m => m == mode),

    /**
     * Returns true if this abbreviation is defined in any of *modes*.
     *
     * @param {[Modes]} modes The modes to test.
     * @returns {boolean} The result of the comparison.
     */
    inModes: function (modes) modes.some(mode => this.inMode(mode)),

    /**
     * Remove *mode* from the list of supported modes for this abbreviation.
     *
     * @param {Mode} mode The mode to remove.
     */
    removeMode: function (mode) {
        this.modes = this.modes.filter(m => m != mode)
                               .sort();
    },

    /**
     * @property {string} The mode display characters associated with the
     *     supported mode combination.
     */
    get modeChar() Abbreviation.modeChar(this.modes)
}, {
    modeChar: function (_modes) {
        let result = array.uniq(_modes.map(m => m.char)).join("");
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

    /** @property {boolean} True if there are no abbreviations. */
    get empty() !values(this._store).find(util.identity),

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
     * @returns {Abbreviation} The matching abbreviation.
     */
    get: function (mode, lhs) {
        let abbrevs = this._store[mode];
        return abbrevs && hasOwnProperty(abbrevs, lhs) ? abbrevs[lhs]
                                                       : null;
    },

    /**
     * @property {[Abbreviation]} The list of the abbreviations merged from
     *     each mode.
     */
    get merged() {
        // Wth? --Kris;
        let map = values(this._store).map(Iterator).map(iter.toArray)
                                     .flatten().toObject();
        return Object.keys(map).sort().map(k => map[k]);
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

        this._match = util.regexp(literal(function () /*
            (^ | \s | <nonkeyword>) (<keyword>+             )$ | // full-id
            (^ | \s | <keyword>   ) (<nonkeyword>+ <keyword>)$ | // end-id
            (^ | \s               ) (\S* <nonkeyword>       )$   // non-id
        */$), "x", params);
        this._check = util.regexp(literal(function () /*
            ^ (?:
              <keyword>+              | // full-id
              <nonkeyword>+ <keyword> | // end-id
              \S* <nonkeyword>          // non-id
            ) $
        */$), "x", params);
    },

    get allHives() contexts.allGroups.abbrevs,

    get userHives() this.allHives.filter(h => h !== this.builtin),

    get: deprecated("group.abbrevs.get", { get: function get() this.user.bound.get }),
    set: deprecated("group.abbrevs.set", { get: function set() this.user.bound.set }),
    remove: deprecated("group.abbrevs.remove", { get: function remove() this.user.bound.remove }),
    removeAll: deprecated("group.abbrevs.clear", { get: function removeAll() this.user.bound.clear }),

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
            return this.hives.map(h => h.get(mode, match[2] || match[4] || match[6]))
                       .find(util.identity);
        return null;
    },

    /**
     * Lists all abbreviations matching *modes*, *lhs* and optionally *hives*.
     *
     * @param {Array} modes List of modes.
     * @param {string} lhs The LHS of the abbreviation.
     * @param {[Hive]} hives List of hives.
     * @optional
     */
    list: function (modes, lhs, hives) {
        hives = (hives || this.userHives).filter(h => !h.empty);

        function abbrevs(hive)
            hive.merged.filter(ab => (ab.inModes(modes) && ab.lhs.startsWith(lhs)));

        let list = ["table", {},
                ["tr", { highlight: "Title" },
                    ["td"],
                    ["td", { style: "padding-right: 1em;" }, _("title.Mode")],
                    ["td", { style: "padding-right: 1em;" }, _("title.Abbrev")],
                    ["td", { style: "padding-right: 1em;" }, _("title.Replacement")]],
                ["col", { style: "min-width: 6em; padding-right: 1em;" }],
                hives.map(hive => let (i = 0) [
                    ["tr", { style: "height: .5ex;" }],
                    abbrevs(hive).map(abbrev =>
                        ["tr", {},
                            ["td", { highlight: "Title" }, !i++ ? String(hive.name) : ""],
                            ["td", {}, abbrev.modeChar],
                            ["td", {}, abbrev.lhs],
                            ["td", {}, abbrev.rhs]]),
                    ["tr", { style: "height: .5ex;" }]])];

        // FIXME?
        // // TODO: Move this to an ItemList to show this automatically
        // if (list.*.length() === list.text().length() + 2)
        //     dactyl.echomsg(_("abbreviation.none"));
        // else
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
    completion: function initCompletion() {
        completion.abbreviation = function abbreviation(context, modes, group) {
            group = group || abbreviations.user;
            let fn = modes ? abbr => abbr.inModes(modes)
                           : abbr => abbr;
            context.keys = { text: "lhs" , description: "rhs" };
            context.completions = group.merged.filter(fn);
        };
    },
    commands: function initCommands() {
        function addAbbreviationCommands(modes, ch, modeDescription) {
            modes.sort();
            modeDescription = modeDescription ? " in " + modeDescription + " mode" : "";

            commands.add([ch ? ch + "a[bbreviate]" : "ab[breviate]"],
                "Abbreviate a key sequence" + modeDescription,
                function (args) {
                    let [lhs, rhs] = args;
                    dactyl.assert(!args.length || abbreviations._check.test(lhs),
                                  _("error.invalidArgument"));

                    if (!rhs) {
                        let hives = args.explicitOpts["-group"] ? [args["-group"]] : null;
                        abbreviations.list(modes, lhs || "", hives);
                    }
                    else {
                        if (args["-javascript"])
                            rhs = contexts.bindMacro({ literalArg: rhs }, "-javascript", ["editor"]);
                        args["-group"].add(modes, lhs, rhs);
                    }
                }, {
                    identifier: "abbreviate",
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
                    serialize: function () array(abbreviations.userHives)
                        .filter(h => h.persist)
                        .map(hive => [
                            {
                                command: this.name,
                                arguments: [abbr.lhs],
                                literalArg: abbr.rhs,
                                options: {
                                    "-group": hive.name == "user" ? undefined : hive.name,
                                    "-javascript": callable(abbr.rhs) ? null : undefined
                                }
                            }
                            for ([, abbr] in Iterator(hive.merged))
                            if (abbr.modesEqual(modes))
                        ]).
                        flatten().array
                });

            commands.add([ch + "una[bbreviate]"],
                "Remove an abbreviation" + modeDescription,
                function (args) {
                    util.assert(args.bang ^ !!args[0], _("error.argumentOrBang"));

                    if (args.bang)
                        args["-group"].clear(modes);
                    else if (!args["-group"].remove(modes, args[0]))
                        return dactyl.echoerr(_("abbreviation.noSuch"));
                }, {
                    argCount: "?",
                    bang: true,
                    completer: function (context, args) completion.abbreviation(context, modes, args["-group"]),
                    literal: 0,
                    options: [contexts.GroupFlag("abbrevs")]
                });
        }

        addAbbreviationCommands([modes.INSERT, modes.COMMAND_LINE], "", "");
        [modes.INSERT, modes.COMMAND_LINE].forEach(function (mode) {
            addAbbreviationCommands([mode], mode.char, mode.displayName);
        });
    }
});

// vim: set fdm=marker sw=4 sts=4 ts=8 et:
