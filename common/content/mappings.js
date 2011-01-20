// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

/**
 * A class representing key mappings. Instances are created by the
 * {@link Mappings} class.
 *
 * @param {number[]} modes The modes in which this mapping is active.
 * @param {string[]} keys The key sequences which are bound to
 *     *action*.
 * @param {string} description A short one line description of the key mapping.
 * @param {function} action The action invoked by each key sequence.
 * @param {Object} extraInfo An optional extra configuration hash. The
 *     following properties are supported.
 *         arg     - see {@link Map#arg}
 *         count   - see {@link Map#count}
 *         motion  - see {@link Map#motion}
 *         route   - see {@link Map#route}
 *         noremap - see {@link Map#noremap}
 *         rhs     - see {@link Map#rhs}
 *         silent  - see {@link Map#silent}
 * @optional
 * @private
 */
var Map = Class("Map", {
    init: function (modes, keys, description, action, extraInfo) {
        modes = Array.concat(modes).map(function (m) isObject(m) ? m.mask : m);
        if (!modes.every(util.identity))
            throw Error("Invalid modes");

        this.id = ++Map.id;
        this.modes = modes;
        this.names = keys.map(events.closure.canonicalKeys);
        this.name = this.names[0];
        this.action = action;
        this.description = description;

        if (Object.freeze)
            Object.freeze(this.modes);

        if (extraInfo)
            update(this, extraInfo);
    },

    /** @property {number[]} All of the modes for which this mapping applies. */
    modes: null,
    /** @property {string[]} All of this mapping's names (key sequences). */
    names: null,
    /** @property {function (number)} The function called to execute this mapping. */
    action: null,
    /** @property {string} This mapping's description, as shown in :listkeys. */
    description: "",

    /** @property {boolean} Whether this mapping accepts an argument. */
    arg: false,
    /** @property {boolean} Whether this mapping accepts a count. */
    count: false,
    /**
     * @property {boolean} Whether the mapping accepts a motion mapping
     *     as an argument.
     */
    motion: false,
    /**
     * @property {boolean} Whether the mapping's key events should be
     *     propagated to the host application.
     */
    // TODO: I'm not sure this is the best name but it reflects that which it replaced. --djk
    route: false,
    /** @property {boolean} Whether the RHS of the mapping should expand mappings recursively. */
    noremap: false,
    /** @property {boolean} Whether any output from the mapping should be echoed on the command line. */
    silent: false,
    /** @property {string} The literal RHS expansion of this mapping. */
    rhs: null,
    /**
     * @property {boolean} Specifies whether this is a user mapping. User
     *     mappings may be created by plugins, or directly by users. Users and
     *     plugin authors should create only user mappings.
     */
    user: false,

    /**
     * Returns whether this mapping can be invoked by a key sequence matching
     * *name*.
     *
     * @param {string} name The name to query.
     * @returns {boolean}
     */
    hasName: function (name) this.keys.indexOf(name) >= 0,

    keys: Class.memoize(function () this.names.map(mappings._expandLeader)),

    /**
     * Execute the action for this mapping.
     *
     * @param {string} motion The motion argument if accepted by this mapping.
     *     E.g. "w" for "dw"
     * @param {number} count The associated count. E.g. "5" for "5j"
     * @default -1
     * @param {string} argument The normal argument if accepted by this
     *     mapping. E.g. "a" for "ma"
     */
    execute: function (motion, count, argument, command) {
        let args = { count: count, arg: argument, motion: motion, command: command };

        let self = this;
        function repeat() self.action(args)
        if (this.names[0] != ".") // FIXME: Kludge.
            mappings.repeat = repeat;

        return dactyl.trapErrors(repeat);
    }

}, {
    id: 0
});

/**
 * @instance mappings
 */
var Mappings = Module("mappings", {
    init: function () {
        this._main = []; // default mappings
        this._user = []; // user created mappings

        dactyl.registerObserver("mode-add", function (mode) {
            if (!(mode.mask in this._user || mode.mask in this._main)) {
                this._main[mode.mask] = [];
                this._user[mode.mask] = [];
            }
        });
    },

    _addMap: function (map) {
        let where = map.user ? this._user : this._main;
        map.definedAt = commands.getCaller(Components.stack.caller.caller);
        map.modes.forEach(function (mode) {
            if (!(mode in where))
                where[mode] = [];
            where[mode].push(map);
        });
    },

    _getMap: function (mode, cmd, stack) {
        let maps = stack[mode] || [];

        for (let [, map] in Iterator(maps))
            if (map.hasName(cmd))
                return map;

        return null;
    },

    _removeMap: function (mode, cmd) {
        let maps = this._user[mode] || [];
        let names;

        for (let [i, map] in Iterator(maps)) {
            let j = map.names.indexOf(cmd);
            if (j >= 0) {
                map.names.splice(j, 1);
                if (map.names.length == 0) // FIX ME.
                    for (let [mode, stack] in Iterator(this._user))
                        this._user[mode] = (stack || []).filter(function (m) m != map);
                return;
            }
        }
    },

    _expandLeader: function (keyString) keyString.replace(/<Leader>/i, options["mapleader"]),

    // Return all mappings present in all @modes
    _mappingsIterator: function (modes, stack) {
        modes = modes.slice();
        return (map for ([i, map] in Iterator(stack[modes.shift()].sort(function (m1, m2) String.localeCompare(m1.name, m2.name))))
            if (map.rhs && modes.every(function (mode) stack[mode].
                    some(function (m) m.rhs && m.rhs === map.rhs && m.name === map.name))));
    },

    iterate: function (mode) {
        let seen = {};
        for (let map in iter(values(this._user[mode]), values(this._main[mode])))
            if (!set.add(seen, map.name))
                yield map;
    },

    // NOTE: just normal mode for now
    /** @property {Iterator(Map)} */
    __iterator__: function () this.iterate(modes.NORMAL),

    // used by :mkpentadactylrc to save mappings
    /**
     * Returns a user-defined mappings iterator for the specified *mode*.
     *
     * @param {number} mode The mode to return mappings from.
     * @returns {Iterator(Map)}
     */
    getUserIterator: function (mode) this._mappingsIterator(mode, this._user),

    /**
     * Adds a new default key mapping.
     *
     * @param {number[]} modes The modes that this mapping applies to.
     * @param {string[]} keys The key sequences which are bound to *action*.
     * @param {string} description A description of the key mapping.
     * @param {function} action The action invoked by each key sequence.
     * @param {Object} extra An optional extra configuration hash.
     * @optional
     */
    add: function (modes, keys, description, action, extra) {
        this._addMap(Map(modes, keys, description, action, extra));
    },

    /**
     * Adds a new user-defined key mapping.
     *
     * @param {number[]} modes The modes that this mapping applies to.
     * @param {string[]} keys The key sequences which are bound to *action*.
     * @param {string} description A description of the key mapping.
     * @param {function} action The action invoked by each key sequence.
     * @param {Object} extra An optional extra configuration hash (see
     *     {@link Map#extraInfo}).
     * @optional
     */
    addUserMap: function (modes, keys, description, action, extra) {
        extra = extra || {};
        extra.user = true;
        let map = Map(modes, keys, description, action, extra);

        // remove all old mappings to this key sequence
        for (let [, name] in Iterator(map.names))
            for (let [, mode] in Iterator(map.modes))
                this._removeMap(mode, name);

        this._addMap(map);
    },

    /**
     * Returns the map from *mode* named *cmd*.
     *
     * @param {number} mode The mode to search.
     * @param {string} cmd The map name to match.
     * @returns {Map}
     */
    get: function (mode, cmd) {
        mode = mode || modes.NORMAL;
        return this._getMap(mode, cmd, this._user) || this._getMap(mode, cmd, this._main);
    },

    /**
     * Returns the default map from *mode* named *cmd*.
     *
     * @param {number} mode The mode to search.
     * @param {string} cmd The map name to match.
     * @returns {Map}
     */
    getDefault: function (mode, cmd) {
        mode = mode || modes.NORMAL;
        return this._getMap(mode, cmd, this._main);
    },

    /**
     * Returns an array of maps with names starting with but not equal to
     * *prefix*.
     *
     * @param {number} mode The mode to search.
     * @param {string} prefix The map prefix string to match.
     * @returns {Map[]}
     */
    getCandidates: function (mode, prefix)
        this._user[mode].concat(this._main[mode])
            .filter(function (map) map.keys.some(
                function (name) name.indexOf(prefix) == 0 && name.length > prefix.length
                                && (prefix != "<" || !/^<.+>/.test(name)))),

    /**
     * Returns whether there is a user-defined mapping *cmd* for the specified
     * *mode*.
     *
     * @param {number} mode The mode to search.
     * @param {string} cmd The candidate key mapping.
     * @returns {boolean}
     */
    hasMap: function (mode, cmd) this._user[mode].some(function (map) map.hasName(cmd)),

    /**
     * Remove the user-defined mapping named *cmd* for *mode*.
     *
     * @param {number} mode The mode to search.
     * @param {string} cmd The map name to match.
     */
    remove: function (mode, cmd) {
        this._removeMap(mode, cmd);
    },

    /**
     * Remove all user-defined mappings for *mode*.
     *
     * @param {number} mode The mode to remove all mappings from.
     */
    removeAll: function (mode) {
        this._user[mode] = [];
    },

    /**
     * Lists all user-defined mappings matching *filter* for the specified
     * *modes*.
     *
     * @param {number[]} modes An array of modes to search.
     * @param {string} filter The filter string to match.
     */
    list: function (modes, filter) {
        let modeSign = "";

        // TODO: Vim hides "nv" in a :map and "v" and "n" in :vmap and
        //       :nmap respectively if the map is not exclusive.
        modes.forEach(function (mode) {
            for (let m in modules.modes.mainModes)
                if (mode == m.mask && modeSign.indexOf(m.char) == -1)
                    modeSign += m.char;
        });

        let maps = this._mappingsIterator(modes, this._user);
        if (filter)
            maps = [map for (map in maps) if (map.names[0] == filter)];

        let list = <table>
                {
                    template.map(maps, function (map)
                        template.map(map.names, function (name)
                        <tr>
                            <td>{modeSign} {name}</td>
                            <td>{map.noremap ? "*" : " "}</td>
                            <td>{map.rhs || map.action.toSource()}</td>
                        </tr>))
                }
                </table>;

        // TODO: Move this to an ItemList to show this automatically
        if (list.*.length() === list.text().length())
            dactyl.echomsg("No mapping found");
        else
            commandline.commandOutput(list);
    }
}, {
}, {
    commands: function () {
        function addMapCommands(ch, mapmodes, modeDescription) {
            function map(args, noremap) {
                let mapmodes = array.uniq(args["-modes"].map(findMode));
                if (!args.length) {
                    mappings.list(mapmodes);
                    return;
                }

                let [lhs, rhs] = args;
                if (noremap)
                    args["-builtin"] = true;

                if (!rhs) // list the mapping
                    mappings.list(mapmodes, mappings._expandLeader(lhs));
                else {
                    mappings.addUserMap(mapmodes, [lhs],
                        args["-description"],
                        Command.bindMacro(args, "-keys", function (params) params),
                        {
                            count: args["-count"],
                            noremap: args["-builtin"],
                            persist: !args["-nopersist"],
                            get rhs() String(this.action),
                            silent: args["-silent"]
                        });
                }
            }

            const opts = {
                    completer: function (context, args) {
                        let mapmodes = array.uniq(args["-modes"].map(findMode));
                        if (args.length == 1)
                            return completion.userMapping(context, mapmodes);
                        if (args.length == 2) {
                            if (args["-javascript"])
                                return completion.javascript(context);
                            if (args["-ex"])
                                return completion.ex(context);
                        }
                    },
                    hereDoc: true,
                    literal: 1,
                    options: [
                        {
                            names: ["-builtin", "-b"],
                            description: "Execute this mapping as if there were no user-defined mappings"
                        },
                        {
                            names: ["-count", "-c"],
                            description: "Accept a count before the requisite key press"
                        },
                        {
                            names: ["-description", "-d"],
                            description: "A description of this mapping",
                            default: "User-defined mapping",
                            type: CommandOption.STRING
                        },
                        {
                            names: ["-ex", "-e"],
                            description: "Execute this mapping as an Ex command rather than keys"
                        },
                        {
                            names: ["-javascript", "-js", "-j"],
                            description: "Execute this mapping as JavaScript rather than keys"
                        },
                        update({}, modeFlag, {
                            names: ["-modes", "-mode", "-m"],
                            type: CommandOption.LIST,
                            description: "Create this mapping in the given modes",
                            default: mapmodes || ["n", "v"],
                        }),
                        {
                            names: ["-nopersist", "-n"],
                            description: "Do not save this mapping to an auto-generated RC file"
                        },
                        {
                            names: ["-silent", "-s", "<silent>", "<Silent>"],
                            description: "Do not echo any generated keys to the command line"
                        }
                    ],
                    serialize: function () {
                        return this.name == "map" ? [
                            {
                                command: this.name,
                                options: array([
                                    ["-modes", uniqueModes(map.modes)],
                                    ["-description", map.description],
                                    map.silent && ["-silent"]])
                                    .filter(util.identity)
                                    .toObject(),
                                arguments: [map.names[0]],
                                literalArg: map.rhs,
                                ignoreDefaults: true
                            }
                            for (map in userMappings())
                            if (map.persist)
                        ] : [];
                    }
            };
            function userMappings() {
                let seen = {};
                for (let [, stack] in Iterator(mappings._user))
                    for (let map in values(stack))
                        if (!set.add(seen, map.id))
                            yield map;
            }

            modeDescription = modeDescription ? " in " + modeDescription + " mode" : "";
            commands.add([ch ? ch + "m[ap]" : "map"],
                "Map a key sequence" + modeDescription,
                function (args) { map(args, false); },
                opts);

            commands.add([ch + "no[remap]"],
                "Map a key sequence without remapping keys" + modeDescription,
                function (args) { map(args, true); },
                opts);

            commands.add([ch + "mapc[lear]"],
                "Remove all mappings" + modeDescription,
                function () { mapmodes.forEach(function (mode) { mappings.removeAll(mode); }); },
                {
                    argCount: "0",
                    options: [ update({}, modeFlag, {
                            names: ["-modes", "-mode", "-m"],
                            type: CommandOption.LIST,
                            description: "Remove all mappings from the given modes",
                            default: mapmodes || ["n", "v"]
                        })
                    ]
                });

            commands.add([ch + "unm[ap]"],
                "Remove a mapping" + modeDescription,
                function (args) {
                    let mapmodes = array.uniq(args["-modes"].map(findMode));

                    let found = false;
                    for (let [, mode] in Iterator(mapmodes)) {
                        if (mappings.hasMap(mode, args[0])) {
                            mappings.remove(mode, args[0]);
                            found = true;
                        }
                    }
                    if (!found)
                        dactyl.echoerr("E31: No such mapping");
                },
                {
                    argCount: "1",
                    completer: opts.completer,
                    options: [ update({}, modeFlag, {
                            names: ["-modes", "-mode", "-m"],
                            type: CommandOption.LIST,
                            description: "Remove mapping from the given modes",
                            default: mapmodes || ["n", "v"]
                        })
                    ]
                });
        }

        let modeFlag = {
            names: ["-mode", "-m"],
            type: CommandOption.STRING,
            validator: function (value) Array.concat(value).every(findMode),
            completer: function () [[array.compact([mode.name.toLowerCase().replace(/_/g, "-"), mode.char]), mode.description]
                                    for (mode in values(modes.all))
                                    if (!mode.hidden)],
        };

        function findMode(name) {
            if (name)
                for (let mode in values(modes.all))
                    if (name == mode || name == mode.char
                        || String.toLowerCase(name).replace(/-/g, "_") == mode.name.toLowerCase())
                        return mode;
            return null;
        }
        function uniqueModes(modes) {
            let chars = [k for ([k, v] in Iterator(modules.modes.modeChars))
                         if (v.every(function (mode) modes.indexOf(mode) >= 0))];
            return array.uniq(modes.filter(function (m) chars.indexOf(m.char) < 0).concat(chars));
        }

        commands.add(["feedkeys", "fk"],
            "Fake key events",
            function (args) { events.feedkeys(args[0] || "", args.bang, false, findMode(args["-mode"])); },
            {
                argCount: "1",
                bang: true,
                literal: 0,
                options: [
                    update({}, modeFlag, {
                        description: "The in which to feed the keys"
                    })
                ]
            });

        addMapCommands("", [modes.NORMAL, modes.VISUAL], "");

        let args = {
            getMode: function (args) findMode(args["-mode"]),
            iterate: function (args) {
                for (let map in mappings.iterate(this.getMode(args)))
                    for (let name in values(map.names))
                        yield { name: name, __proto__: map };
            },
            format: {
                description: function (map) (XML.ignoreWhitespace = false, XML.prettyPrinting = false, <>
                        {options.get("passkeys").has(map.name)
                            ? <span highlight="URLExtra">(passed by {template.helpLink("'passkeys'")})</span>
                            : <></>}
                        {template.linkifyHelp(map.description + (map.rhs ? ": " + map.rhs : ""))}
                </>),
                help: function (map) let (char = array.compact(map.modes.map(function (m) m.char))[0])
                    char === "n" ? map.name : char ? char + "_" + map.name : ""
            }
        }

        dactyl.addUsageCommand({
            __proto__: args,
            name: ["listk[eys]", "lk"],
            description: "List all mappings along with their short descriptions",
            options: [
                update({}, modeFlag, {
                    default: "n",
                    description: "The mode for which to list mappings"
                })
            ]
        });

        iter.forEach(modes.mainModes, function (mode) {
            if (mode.char && !commands.get(mode.char + "listkeys", true))
                dactyl.addUsageCommand({
                    __proto__: args,
                    name: [mode.char + "listk[eys]", mode.char + "lk"],
                    iterateIndex: function (args)
                            let (self = this, prefix = mode.char == "n" ? "" : mode.char + "_")
                                    ({ helpTag: prefix + map.name, __proto__: map }
                                     for (map in self.iterate(args))),
                    description: "List all " + mode.name + " mode mappings along with their short descriptions",
                    index: mode.char + "-map",
                    getMode: function (args) mode,
                    options: []
                });
        });

        for (let mode in modes.mainModes)
            if (mode.char && !commands.get(mode.char + "map", true))
                addMapCommands(mode.char,
                               [m.mask for (m in modes.mainModes) if (m.char == mode.char)],
                               [mode.disp.toLowerCase()]);
    },
    completion: function () {
        completion.userMapping = function userMapping(context, modes) {
            // FIXME: have we decided on a 'standard' way to handle this clash? --djk
            modes = modes || [modules.modes.NORMAL];
            context.completions = [[m.names[0], m.description + ": " + m.action] for (m in mappings.getUserIterator(modes))];
        };
    },
    javascript: function () {
        JavaScript.setCompleter(this.get,
            [
                null,
                function (context, obj, args) {
                    let mode = args[0];
                    return array.flatten([
                        [[name, map.description] for ([i, name] in Iterator(map.names))]
                        for ([i, map] in Iterator(mappings._user[mode].concat(mappings._main[mode])))
                    ]);
                }
            ]);
    },
    modes: function () {
        for (let mode in modes) {
            this._main[mode] = [];
            this._user[mode] = [];
        }
    },
    options: function () {
        options.add(["mapleader", "ml"],
            "Define the replacement keys for the <Leader> pseudo-key",
            "string", "\\", {
                setter: function (value) {
                    if (this.hasChanged)
                        for (let hive in values([mappings._user, mappings._main]))
                            for (let mode in values(hive))
                                for (let map in values(mode))
                                    delete map.keys;
                    return value;
                }
            });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
