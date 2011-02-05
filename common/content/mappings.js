// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k at Gmail>
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
        this._keys = keys;
        this.action = action;
        this.description = description;

        if (Object.freeze)
            Object.freeze(this.modes);

        if (extraInfo)
            update(this, extraInfo);
    },

    name: Class.memoize(function () this.names[0]),

    /** @property {string[]} All of this mapping's names (key sequences). */
    names: Class.memoize(function () this._keys.map(events.closure.canonicalKeys)),

    get toStringParams() [this.modes.map(function (m) m.name), this.names.map(String.quote)],

    /** @property {number} A unique ID for this mapping. */
    id: null,
    /** @property {number[]} All of the modes for which this mapping applies. */
    modes: null,
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

    get keys() this.names.map(mappings.expandLeader),

    /**
     * Execute the action for this mapping.
     *
     * @param {object} args The arguments object for the given mapping.
     */
    execute: function (args) {
        if (!isObject(args)) // Backwards compatibility :(
            args = iter(["motion", "count", "arg", "command"])
                .map(function ([i, prop]) [prop, this[i]], arguments)
                .toObject();

        if (!args.context)
            args.context = contexts.context;

        let self = this;
        function repeat() self.action(args)
        if (this.names[0] != ".") // FIXME: Kludge.
            mappings.repeat = repeat;

        if (this.executing)
            util.dumpStack("Attempt to execute mapping recursively: " + args.command);
        dactyl.assert(!this.executing, "Attempt to execute mapping recursively: " + args.command);

        try {
            this.executing = true;
            var res = repeat();
        }
        catch (e) {
            events.feedingKeys = false;
            dactyl.reportError(e, true);
        }
        finally {
            this.executing = false;
        }
        return res;
    }

}, {
    id: 0
});

var MapHive = Class("MapHive", {
    init: function init(group) {
        this.group = group;
        this.stacks = {};
    },

    get toStringParams() [this.group.name],

    get builtin() this.group.builtin,

    /**
     * Iterates over all mappings present in all of the given *modes*.
     *
     * @param {[Modes.Mode]} modes The modes for which to return mappings.
     */
    iterate: function (modes) {
        let stacks = Array.concat(modes).map(this.closure.getStack);
        return values(stacks.shift().sort(function (m1, m2) String.localeCompare(m1.name, m2.name))
            .filter(function (map) map.rhs &&
                stacks.every(function (stack) stack.some(function (m) m.rhs && m.rhs === map.rhs && m.name === map.name))));
    },

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
        extra = extra || {};

        let map = Map(modes, keys, description, action, extra);
        map.definedAt = Commands.getCaller(Components.stack.caller);
        map.hive = this;

        if (this.name !== "builtin")
            for (let [, name] in Iterator(map.names))
                for (let [, mode] in Iterator(map.modes))
                    this.remove(mode, name);

        for (let mode in values(map.modes))
            this.getStack(mode).add(map);
        return map;
    },

    /**
     * Returns the mapping stack for the given mode.
     *
     * @param {Modes.Mode} mode The mode to search.
     * @returns {[Map]}
     */
    getStack: function getStack(mode) {
        if (!(mode in this.stacks))
            return this.stacks[mode] = MapHive.Stack();
        return this.stacks[mode];
    },

    /**
     * Returns the map from *mode* named *cmd*.
     *
     * @param {Modes.Mode} mode The mode to search.
     * @param {string} cmd The map name to match.
     * @returns {Map|null}
     */
    get: function (mode, cmd) this.getStack(mode).mappings[cmd],

    /**
     * Returns a count of maps with names starting with but not equal to
     * *prefix*.
     *
     * @param {Modes.Mode} mode The mode to search.
     * @param {string} prefix The map prefix string to match.
     * @returns {number)
     */
    getCandidates: function (mode, prefix) this.getStack(mode).candidates[prefix] || 0,

    /**
     * Returns whether there is a user-defined mapping *cmd* for the specified
     * *mode*.
     *
     * @param {Modes.Mode} mode The mode to search.
     * @param {string} cmd The candidate key mapping.
     * @returns {boolean}
     */
    has: function (mode, cmd) this.getStack(mode).mappings[cmd] != null,

    /**
     * Remove the mapping named *cmd* for *mode*.
     *
     * @param {Modes.Mode} mode The mode to search.
     * @param {string} cmd The map name to match.
     */
    remove: function (mode, cmd) {
        let stack = this.getStack(mode);
        for (let [i, map] in array.iterItems(stack)) {
            let j = map.names.indexOf(cmd);
            if (j >= 0) {
                delete stack.states;
                map.names.splice(j, 1);
                if (map.names.length == 0) // FIX ME.
                    for (let [mode, stack] in Iterator(this.stacks))
                        this.stacks[mode] = MapHive.Stack(stack.filter(function (m) m != map));
                return;
            }
        }
    },

    /**
     * Remove all user-defined mappings for *mode*.
     *
     * @param {Modes.Mode} mode The mode to remove all mappings from.
     */
    clear: function (mode) {
        this.stacks[mode] = MapHive.Stack([]);
    }
}, {
    Stack: Class("Stack", Array, {
        init: function (ary) {
            let self = ary || [];
            self.__proto__ = this.__proto__;
            return self;
        },

        __iterator__: function () array.iterValues(this),

        get candidates() this.states.candidates,
        get mappings() this.states.mappings,

        add: function (map) {
            this.push(map);
            delete this.states;
        },

        states: Class.memoize(function () {
            var states = {
                candidates: {},
                mappings: {}
            };

            for (let map in this)
                for (let name in values(map.keys)) {
                    states.mappings[name] = map;
                    let state = "";
                    for (let key in events.iterKeys(name)) {
                        state += key;
                        if (state !== name)
                            states.candidates[state] = (states.candidates[state] || 0) + 1;
                    }
                }
            return states;
        })
    })
});

/**
 * @instance mappings
 */
var Mappings = Module("mappings", {
    init: function () {
        this.user = contexts.subGroup.mappings.user;
        this.builtin = contexts.subGroup.mappings.builtin;
    },

    repeat: Modes.boundProperty(),

    hives: Group.SubGroup("mappings", MapHive),

    get allHives() contexts.allGroups.mappings,

    get userHives() this.allHives.filter(function (h) h !== this.builtin, this),

    expandLeader: function (keyString) keyString.replace(/<Leader>/i, options["mapleader"]),

    iterate: function (mode) {
        let seen = {};
        for (let hive in this.hives.iterValues())
            for (let map in array(hive.getStack(mode)).iterValues())
                if (!set.add(seen, map.name))
                    yield map;
    },

    // NOTE: just normal mode for now
    /** @property {Iterator(Map)} */
    __iterator__: function () this.iterate(modes.NORMAL),

    getDefault: deprecated("mappings.builtin.get", function getDefault(mode, cmd) this.builtin.get(mode, cmd)),
    getUserIterator: deprecated("mappings.user.iterator", function getUserIterator(modes) this.user.iterator(modes)),
    hasMap: deprecated("mappings.user.has", function hasMap(mode, cmd) this.user.has(mode, cmd)),
    remove: deprecated("mappings.user.remove", function remove(mode, cmd) this.user.remove(mode, cmd)),
    removeAll: deprecated("mappings.user.clear", function removeAll(mode) this.user.clear(mode)),

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
    add: function () {
        let map = this.builtin.add.apply(this.builtin, arguments);
        map.definedAt = Commands.getCaller(Components.stack.caller);
        return map;
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
    addUserMap: function () {
        let map = this.user.add.apply(this.user, arguments);
        map.definedAt = Commands.getCaller(Components.stack.caller);
        return map;
    },

    /**
     * Returns the map from *mode* named *cmd*.
     *
     * @param {number} mode The mode to search.
     * @param {string} cmd The map name to match.
     * @returns {Map}
     */
    get: function get(mode, cmd) this.hives.map(function (h) h.get(mode, cmd)).compact()[0] || null,

    /**
     * Returns an array of maps with names starting with but not equal to
     * *prefix*.
     *
     * @param {number} mode The mode to search.
     * @param {string} prefix The map prefix string to match.
     * @returns {Map[]}
     */
    getCandidates: function (mode, prefix)
        this.hives.map(function (h) h.getCandidates(mode, prefix))
                  .flatten(),

    /**
     * Lists all user-defined mappings matching *filter* for the specified
     * *modes*.
     *
     * @param {number[]} modes An array of modes to search.
     * @param {string} filter The filter string to match.
     */
    list: function (modes, filter, hives) {
        hives = hives || mappings.userHives;

        let modeSign = "";
        modes.filter(function (m)  m.char).forEach(function (m) { modeSign += m.char; });
        modes.filter(function (m) !m.char).forEach(function (m) { modeSign += " " + m.name; });
        modeSign = modeSign.replace(/^ /, "");

        function maps(hive) {
            let maps = hive.iterate(modes);
            if (filter)
                maps = [map for (map in maps) if (map.names[0] == filter)];
            return maps;
        }

        let list = <table>
                <tr highlight="Title">
                    <td/>
                    <td style="padding-right: 1em;">Mode</td>
                    <td style="padding-right: 1em;">Command</td>
                    <td style="padding-right: 1em;">Action</td>
                </tr>
                <col style="min-width: 6em; padding-right: 1em;"/>
                {
                    template.map(hives, function (hive)
                        <tr style="height: .5ex;"/> +
                        template.map(maps(hive), function (map)
                            template.map(map.names, function (name, i)
                            <tr>
                                <td highlight="Title">{!i ? hive.group.name : ""}</td>
                                <td>{modeSign}</td>
                                <td>{name}</td>
                                <td>{map.rhs || map.action.toSource()}</td>
                            </tr>)) +
                        <tr style="height: .5ex;"/>)
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
                let hives = args.explicitOpts["-group"] ? [args["-group"]] : null;

                if (!args.length) {
                    mappings.list(mapmodes, null, hives);
                    return;
                }

                let [lhs, rhs] = args;
                if (noremap)
                    args["-builtin"] = true;

                if (!rhs) // list the mapping
                    mappings.list(mapmodes, mappings.expandLeader(lhs), hives);
                else {
                    args["-group"].add(mapmodes, [lhs],
                        args["-description"],
                        contexts.bindMacro(args, "-keys", function (params) params),
                        {
                            arg: args["-arg"],
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
                            return completion.userMapping(context, mapmodes, args["-group"]);
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
                            names: ["-arg", "-a"],
                            description: "Accept an argument after the requisite key press",
                        },
                        {
                            names: ["-builtin", "-b"],
                            description: "Execute this mapping as if there were no user-defined mappings"
                        },
                        {
                            names: ["-count", "-c"],
                            description: "Accept a count before the requisite key press"
                        },
                        {
                            names: ["-description", "-desc", "-d"],
                            description: "A description of this mapping",
                            default: "User-defined mapping",
                            type: CommandOption.STRING
                        },
                        {
                            names: ["-ex", "-e"],
                            description: "Execute this mapping as an Ex command rather than keys"
                        },
                        contexts.GroupFlag("mappings"),
                        {
                            names: ["-javascript", "-js", "-j"],
                            description: "Execute this mapping as JavaScript rather than keys"
                        },
                        update({}, modeFlag, {
                            names: ["-modes", "-mode", "-m"],
                            type: CommandOption.LIST,
                            description: "Create this mapping in the given modes",
                            default: mapmodes || ["n", "v"]
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
                        return this.name != "map" ? [] :
                            array(mappings.userHives)
                                .filter(function (h) !h.noPersist)
                                .map(function (hive) [
                                    {
                                        command: "mapgroup",
                                        bang: true,
                                        arguments: [hive.name, String(hive.filter)].slice(0, hive.name == "user" ? 1 : 2)
                                    }
                                ].concat([
                                    {
                                        command: "map",
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
                                    for (map in userMappings(hive))
                                    if (map.persist)
                                ]))
                                .flatten().array;
                    }
            };
            function userMappings(hive) {
                let seen = {};
                for (let stack in values(hive.stacks))
                    for (let map in array.iterValues(stack))
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
                function (args) {
                    let mapmodes = array.uniq(args["-modes"].map(findMode));
                    mapmodes.forEach(function (mode) {
                        args["-group"].clear(mode);
                    });
                },
                {
                    argCount: "0",
                    options: [
                        contexts.GroupFlag("mappings"),
                        update({}, modeFlag, {
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
                        if (args["-group"].has(mode, args[0])) {
                            args["-group"].remove(mode, args[0]);
                            found = true;
                        }
                    }
                    if (!found)
                        dactyl.echoerr("E31: No such mapping");
                },
                {
                    argCount: "1",
                    completer: opts.completer,
                    options: [
                        contexts.GroupFlag("mappings"),
                        update({}, modeFlag, {
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
                        description: "The mode in which to feed the keys"
                    })
                ]
            });

        addMapCommands("", [modes.NORMAL, modes.VISUAL], "");

        let args = {
            getMode: function (args) findMode(args["-mode"]),
            iterate: function (args) {
                let mainMode = this.getMode(args);
                let seen = {};
                for (let mode in values([mainMode].concat(mainMode.bases)))
                    for (let hive in mappings.hives.iterValues())
                        for (let map in array.iterValues(hive.getStack(mode)))
                            for (let name in values(map.names))
                                if (!set.add(seen, name)) {
                                    yield {
                                        name: name,
                                        columns: [
                                            mode == mainMode ? "" : <span highlight="Object" style="padding-right: 1em;">{mode.name}</span>,
                                            hive.name == "builtin" ? "" : <span highlight="Object" style="padding-right: 1em;">{hive.name}</span>
                                        ],
                                        __proto__: map
                                    };
                                }
            },
            format: {
                description: function (map) (XML.ignoreWhitespace = false, XML.prettyPrinting = false, <>
                        {options.get("passkeys").has(map.name)
                            ? <span highlight="URLExtra">(passed by {template.helpLink("'passkeys'")})</span>
                            : <></>}
                        {template.linkifyHelp(map.description + (map.rhs ? ": " + map.rhs : ""))}
                </>),
                help: function (map) let (char = array.compact(map.modes.map(function (m) m.char))[0])
                    char === "n" ? map.name : char ? char + "_" + map.name : "",
                headings: ["Command", "Mode", "Group", "Description"]
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
                               [mode.name.toLowerCase()]);
    },
    completion: function () {
        completion.userMapping = function userMapping(context, modes, hive) {
            // FIXME: have we decided on a 'standard' way to handle this clash? --djk
            hive = hive || mappings.user;
            modes = modes || [modules.modes.NORMAL];
            context.keys = { text: function (m) m.names[0], description: function (m) m.description + ": " + m.action };
            context.completions = hive.iterate(modes);
        };
    },
    javascript: function () {
        JavaScript.setCompleter(mappings.get,
            [
                null,
                function (context, obj, args) {
                    let mode = args[0];
                    return array.flatten([
                        [[name, map.description] for ([i, name] in Iterator(map.names))]
                        for (map in mappings.iterate(mode))
                    ]);
                }
            ]);
    },
    options: function () {
        options.add(["mapleader", "ml"],
            "Define the replacement keys for the <Leader> pseudo-key",
            "string", "\\", {
                setter: function (value) {
                    if (this.hasChanged)
                        for (let hive in values(mappings.allHives))
                            for (let stack in values(hive.stacks))
                                delete stack.states;
                    return value;
                }
            });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
