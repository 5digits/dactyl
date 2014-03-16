// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

/**
 * A class representing key mappings. Instances are created by the
 * {@link Mappings} class.
 *
 * @param {[Modes.Mode]} modes The modes in which this mapping is active.
 * @param {[string]} keys The key sequences which are bound to
 *     *action*.
 * @param {string} description A short one line description of the key mapping.
 * @param {function} action The action invoked by each key sequence.
 * @param {Object} info An optional extra configuration hash. The
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
    init: function (modes, keys, description, action, info) {
        this.id = ++Map.id;
        this.modes = modes;
        this._keys = keys;
        this.action = action;
        this.description = description;

        Object.freeze(this.modes);

        if (info) {
            if (hasOwnProperty(Map.types, info.type))
                this.update(Map.types[info.type]);
            this.update(info);
        }
    },

    name: Class.Memoize(function () this.names[0]),

    /** @property {[string]} All of this mapping's names (key sequences). */
    names: Class.Memoize(function () this._keys.map(k => DOM.Event.canonicalKeys(k))),

    get toStringParams() [this.modes.map(m => m.name),
                          this.names.map(String.quote)],

    get identifier() [this.modes[0].name, this.hive.prefix + this.names[0]].join("."),

    /** @property {number} A unique ID for this mapping. */
    id: null,
    /** @property {[Modes.Mode]} All of the modes for which this mapping applies. */
    modes: null,
    /** @property {function (number)} The function called to execute this mapping. */
    action: null,
    /** @property {string} This mapping's description, as shown in :listkeys. */
    description: Messages.Localized(""),

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

    /** @property {function(object)} A function to be executed before this mapping. */
    preExecute: function preExecute(args) {},
    /** @property {function(object)} A function to be executed after this mapping. */
    postExecute: function postExecute(args) {},

    /** @property {boolean} Whether any output from the mapping should be echoed on the command line. */
    silent: false,

    /** @property {string} The literal RHS expansion of this mapping. */
    rhs: null,

    /** @property {string} The type of this mapping. */
    type: "",

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

    get keys() array.flatten(this.names.map(mappings.bound.expand)),

    /**
     * Execute the action for this mapping.
     *
     * @param {object} args The arguments object for the given mapping.
     */
    execute: function (args) {
        if (!isObject(args)) // Backwards compatibility :(
            args = iter(["motion", "count", "arg", "command"])
                .map(([i, prop]) => [prop, this[i]], arguments)
                .toObject();

        args = this.hive.makeArgs(this.hive.group.lastDocument,
                                  contexts.context,
                                  args);

        let repeat = () => this.action(args);
        if (this.names[0] != ".") // FIXME: Kludge.
            mappings.repeat = repeat;

        if (this.executing)
            util.assert(!args.keypressEvents[0].isMacro,
                        _("map.recursive", args.command),
                        false);

        try {
            dactyl.triggerObserver("mappings.willExecute", this, args);
            mappings.pushCommand();
            this.preExecute(args);
            this.executing = true;
            var res = repeat();
        }
        catch (e) {
            events.feedingKeys = false;
            dactyl.reportError(e, true);
        }
        finally {
            this.executing = false;
            mappings.popCommand();
            this.postExecute(args);
            dactyl.triggerObserver("mappings.executed", this, args);
        }
        return res;
    }

}, {
    id: 0,

    types: {}
});

var MapHive = Class("MapHive", Contexts.Hive, {
    init: function init(group) {
        init.supercall(this, group);
        this.stacks = {};
    },

    /**
     * Iterates over all mappings present in all of the given *modes*.
     *
     * @param {[Modes.Mode]} modes The modes for which to return mappings.
     */
    iterate: function (modes) {
        let stacks = Array.concat(modes).map(this.bound.getStack);
        return values(stacks.shift().sort((m1, m2) => String.localeCompare(m1.name, m2.name))
            .filter((map) => map.rhs &&
                stacks.every(stack => stack.some(m => m.rhs && m.rhs === map.rhs && m.name === map.name))));
    },

    /**
     * Adds a new key mapping.
     *
     * @param {[Modes.Mode]} modes The modes that this mapping applies to.
     * @param {[string]} keys The key sequences which are bound to *action*.
     * @param {string} description A description of the key mapping.
     * @param {function} action The action invoked by each key sequence.
     * @param {Object} extra An optional extra configuration hash.
     * @optional
     */
    add: function (modes, keys, description, action, extra={}) {
        modes = Array.concat(modes);
        if (!modes.every(util.identity))
            throw TypeError(/*L*/"Invalid modes: " + modes);

        let map = Map(modes, keys, description, action, extra);
        map.definedAt = contexts.getCaller(Components.stack.caller);
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
                        this.stacks[mode] = MapHive.Stack(stack.filter(m => m != map));
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

        states: Class.Memoize(function () {
            var states = {
                candidates: {},
                mappings: {}
            };

            for (let map in this)
                for (let name in values(map.keys)) {
                    states.mappings[name] = map;
                    let state = "";
                    for (let key in DOM.Event.iterKeys(name)) {
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
        this.watches = [];
        this._watchStack = 0;
        this._yielders = 0;
    },

    afterCommands: function afterCommands(count, cmd, self) {
        this.watches.push([cmd, self, Math.max(this._watchStack - 1, 0), count || 1]);
    },

    pushCommand: function pushCommand(cmd) {
        this._watchStack++;
        this._yielders = util.yielders;
    },
    popCommand: function popCommand(cmd) {
        this._watchStack = Math.max(this._watchStack - 1, 0);
        if (util.yielders > this._yielders)
            this._watchStack = 0;

        this.watches = this.watches.filter(function (elem) {
            if (this._watchStack <= elem[2])
                elem[3]--;
            if (elem[3] <= 0)
                elem[0].call(elem[1] || null);
            return elem[3] > 0;
        }, this);
    },

    repeat: Modes.boundProperty(),

    get allHives() contexts.allGroups.mappings,

    get userHives() this.allHives.filter(h => h !== this.builtin),

    expandLeader: deprecated("your brain", function expandLeader(keyString) keyString),

    prefixes: Class.Memoize(function () {
        let list = Array.map("CASM", s => s + "-");

        return iter(util.range(0, 1 << list.length)).map(mask =>
            list.filter((p, i) => mask & (1 << i)).join(""))
                .toArray()
                .concat("*-");
    }),

    expand: function expand(keys) {
        if (!/<\*-/.test(keys))
            var res = keys;
        else
            res = util.debrace(DOM.Event.iterKeys(keys).map(function (key) {
                if (/^<\*-/.test(key))
                    return ["<", this.prefixes, key.slice(3)];
                return key;
            }, this).flatten().array).map(k => DOM.Event.canonicalKeys(k));

        if (keys != arguments[0])
            return [arguments[0]].concat(keys);
        return keys;
    },

    iterate: function (mode) {
        let seen = RealSet();
        for (let hive in this.hives.iterValues())
            for (let map in array(hive.getStack(mode)).iterValues())
                if (!seen.add(map.name))
                    yield map;
    },

    // NOTE: just normal mode for now
    /** @property {Iterator(Map)} */
    __iterator__: function () this.iterate(modes.NORMAL),

    getDefault: deprecated("mappings.builtin.get", function getDefault(mode, cmd) this.builtin.get(mode, cmd)),
    getUserIterator: deprecated("mappings.user.iterator", function getUserIterator(modes) this.user.iterator(modes)),
    hasMap: deprecated("group.mappings.has", function hasMap(mode, cmd) this.user.has(mode, cmd)),
    remove: deprecated("group.mappings.remove", function remove(mode, cmd) this.user.remove(mode, cmd)),
    removeAll: deprecated("group.mappings.clear", function removeAll(mode) this.user.clear(mode)),

    /**
     * Adds a new default key mapping.
     *
     * @param {[Modes.Mode]} modes The modes that this mapping applies to.
     * @param {[string]} keys The key sequences which are bound to *action*.
     * @param {string} description A description of the key mapping.
     * @param {function} action The action invoked by each key sequence.
     * @param {Object} extra An optional extra configuration hash.
     * @optional
     */
    add: function add() {
        let group = this.builtin;
        if (!util.isDactyl(Components.stack.caller)) {
            deprecated.warn(add, "mappings.add", "group.mappings.add");
            group = this.user;
        }

        let map = group.add.apply(group, arguments);
        map.definedAt = contexts.getCaller(Components.stack.caller);
        return map;
    },

    /**
     * Adds a new user-defined key mapping.
     *
     * @param {[Modes.Mode]} modes The modes that this mapping applies to.
     * @param {[string]} keys The key sequences which are bound to *action*.
     * @param {string} description A description of the key mapping.
     * @param {function} action The action invoked by each key sequence.
     * @param {Object} extra An optional extra configuration hash (see
     *     {@link Map#extraInfo}).
     * @optional
     */
    addUserMap: deprecated("group.mappings.add", function addUserMap() {
        let map = this.user.add.apply(this.user, arguments);
        map.definedAt = contexts.getCaller(Components.stack.caller);
        return map;
    }),

    /**
     * Returns the map from *mode* named *cmd*.
     *
     * @param {Modes.Mode} mode The mode to search.
     * @param {string} cmd The map name to match.
     * @returns {Map}
     */
    get: function get(mode, cmd) this.hives.map(h => h.get(mode, cmd))
                                     .compact()[0] || null,

    /**
     * Returns a count of maps with names starting with but not equal to
     * *prefix*.
     *
     * @param {Modes.Mode} mode The mode to search.
     * @param {string} prefix The map prefix string to match.
     * @returns {[Map]}
     */
    getCandidates: function (mode, prefix)
        this.hives.map(h => h.getCandidates(mode, prefix))
                  .reduce((a, b) => (a + b), 0),

    /**
     * Lists all user-defined mappings matching *filter* for the specified
     * *modes* in the specified *hives*.
     *
     * @param {[Modes.Mode]} modes An array of modes to search.
     * @param {string} filter The filter string to match. @optional
     * @param {[MapHive]} hives The map hives to list. @optional
     */
    list: function (modes, filter, hives) {
        let modeSign = modes.map(m => m.char || "").join("")
                     + modes.map(m => !m.char ? " " + m.name : "").join("");
        modeSign = modeSign.replace(/^ /, "");

        hives = (hives || mappings.userHives).map(h => [h, maps(h)])
                                             .filter(([h, m]) => m.length);

        function maps(hive) {
            let maps = iter.toArray(hive.iterate(modes));
            if (filter)
                maps = maps.filter(m => m.names[0] === filter);
            return maps;
        }

        let list = ["table", {},
                ["tr", { highlight: "Title" },
                    ["td", {}],
                    ["td", { style: "padding-right: 1em;" }, _("title.Mode")],
                    ["td", { style: "padding-right: 1em;" }, _("title.Command")],
                    ["td", { style: "padding-right: 1em;" }, _("title.Action")]],
                ["col", { style: "min-width: 6em; padding-right: 1em;" }],
                hives.map(([hive, maps]) => let (i = 0) [
                    ["tr", { style: "height: .5ex;" }],
                    maps.map(map =>
                        map.names.map(name =>
                        ["tr", {},
                            ["td", { highlight: "Title" }, !i++ ? hive.name : ""],
                            ["td", {}, modeSign],
                            ["td", {}, name],
                            ["td", {}, map.rhs || map.action.toSource()]])),
                    ["tr", { style: "height: .5ex;" }]])];

        // E4X-FIXME
        // // TODO: Move this to an ItemList to show this automatically
        // if (list.*.length() === list.text().length() + 2)
        //     dactyl.echomsg(_("map.none"));
        // else
        commandline.commandOutput(list);
    }
}, {
}, {
    contexts: function initContexts(dactyl, modules, window) {
        update(Mappings.prototype, {
            hives: contexts.Hives("mappings", MapHive),
            user: contexts.hives.mappings.user,
            builtin: contexts.hives.mappings.builtin
        });
    },
    commands: function initCommands(dactyl, modules, window) {
        function addMapCommands(ch, mapmodes, modeDescription) {
            function map(args, noremap) {
                let mapmodes = array.uniq(args["-modes"].map(findMode));
                let hives = args.explicitOpts["-group"] ? [args["-group"]] : null;

                if (!args.length) {
                    mappings.list(mapmodes, null, hives);
                    return;
                }

                if (args[1] && !/^<nop>$/i.test(args[1])
                    && !args["-count"] && !args["-ex"] && !args["-javascript"]
                    && mapmodes.every(m => m.count))
                    args[1] = "<count>" + args[1];

                let [lhs, rhs] = args;
                if (noremap)
                    args["-builtin"] = true;

                if (!rhs) // list the mapping
                    mappings.list(mapmodes, lhs, hives);
                else {
                    util.assert(args["-group"].modifiable,
                                _("map.builtinImmutable"));

                    args["-group"].add(mapmodes, [lhs],
                        args["-description"],
                        contexts.bindMacro(args, "-keys", params => params),
                        {
                            arg: args["-arg"],
                            count: args["-count"] || !(args["-ex"] || args["-javascript"]),
                            noremap: args["-builtin"],
                            persist: !args["-nopersist"],
                            get rhs() String(this.action),
                            silent: args["-silent"]
                        });
                }
            }

            const opts = {
                identifier: "map",
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
                        description: "Accept an argument after the requisite key press"
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
                        default: /*L*/"User-defined mapping",
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
                            .filter(h => h.persist)
                            .map(hive => [
                                {
                                    command: "map",
                                    options: {
                                        "-count": map.count ? null : undefined,
                                        "-description": map.description,
                                        "-group": hive.name == "user" ? undefined : hive.name,
                                        "-modes": uniqueModes(map.modes),
                                        "-silent": map.silent ? null : undefined
                                    },
                                    arguments: [map.names[0]],
                                    literalArg: map.rhs,
                                    ignoreDefaults: true
                                }
                                for (map in userMappings(hive))
                                if (map.persist)
                            ])
                            .flatten().array;
                }
            };
            function userMappings(hive) {
                let seen = RealSet();
                for (let stack in values(hive.stacks))
                    for (let map in array.iterValues(stack))
                        if (!seen.add(map.id))
                            yield map;
            }

            modeDescription = modeDescription ? " in " + modeDescription + " mode" : "";
            commands.add([ch ? ch + "m[ap]" : "map"],
                "Map a key sequence" + modeDescription,
                function (args) { map(args, false); },
                update({}, opts));

            commands.add([ch + "no[remap]"],
                "Map a key sequence without remapping keys" + modeDescription,
                function (args) { map(args, true); },
                update({ deprecated: ":" + ch + "map -builtin" }, opts));

            commands.add([ch + "unm[ap]"],
                "Remove a mapping" + modeDescription,
                function (args) {
                    util.assert(args["-group"].modifiable, _("map.builtinImmutable"));

                    util.assert(args.bang ^ !!args[0], _("error.argumentOrBang"));

                    let mapmodes = array.uniq(args["-modes"].map(findMode));

                    let found = 0;
                    for (let mode in values(mapmodes))
                        if (args.bang)
                            args["-group"].clear(mode);
                        else if (args["-group"].has(mode, args[0])) {
                            args["-group"].remove(mode, args[0]);
                            found++;
                        }

                    if (!found && !args.bang)
                        dactyl.echoerr(_("map.noSuch", args[0]));
                },
                {
                    identifier: "unmap",
                    argCount: "?",
                    bang: true,
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
                                    if (!mode.hidden)]
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
                         if (v.every(mode => modes.indexOf(mode) >= 0))];

            return array.uniq(modes.filter(m => chars.indexOf(m.char) < 0)
                                   .map(m => m.name.toLowerCase())
                                   .concat(chars));
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

        for (let mode in modes.mainModes)
            if (mode.char && !commands.get(mode.char + "map", true))
                addMapCommands(mode.char,
                               [m.mask for (m in modes.mainModes) if (m.char == mode.char)],
                               mode.displayName);

        let args = {
            getMode: function (args) findMode(args["-mode"]),
            iterate: function (args, mainOnly) {
                let modes = [this.getMode(args)];
                if (!mainOnly)
                    modes = modes[0].allBases;

                let seen = RealSet();
                // Bloody hell. --Kris
                for (let [i, mode] in Iterator(modes))
                    for (let hive in mappings.hives.iterValues())
                        for (let map in array.iterValues(hive.getStack(mode)))
                            for (let name in values(map.names))
                                if (!seen.add(name))
                                    yield {
                                        name: name,
                                        columns: [
                                            i === 0 ? "" : ["span", { highlight: "Object", style: "padding-right: 1em;" },
                                                                mode.name],
                                            hive == mappings.builtin ? "" : ["span", { highlight: "Object", style: "padding-right: 1em;" },
                                                                                 hive.name]
                                        ],
                                        __proto__: map
                                    };
            },
            format: {
                description: function (map) [
                        options.get("passkeys").has(map.name)
                            ? ["span", { highlight: "URLExtra" },
                                "(", template.linkifyHelp(_("option.passkeys.passedBy")), ")"]
                            : [],
                        template.linkifyHelp(map.description + (map.rhs ? ": " + map.rhs : ""))
                ],
                help: function (map) let (char = array.compact(map.modes.map(m => m.char))[0])
                    char === "n" ? map.name : char ? char + "_" + map.name : "",
                headings: ["Command", "Mode", "Group", "Description"]
            }
        };

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
                            let (self = this, prefix = /^[bCmn]$/.test(mode.char) ? "" : mode.char + "_",
                                 haveTag = k => hasOwnProperty(help.tags, k))
                                    ({ helpTag: prefix + map.name, __proto__: map }
                                     for (map in self.iterate(args, true))
                                     if (map.hive === mappings.builtin || haveTag(prefix + map.name))),
                    description: "List all " + mode.displayName + " mode mappings along with their short descriptions",
                    index: mode.char + "-map",
                    getMode: function (args) mode,
                    options: []
                });
        });
    },
    completion: function initCompletion(dactyl, modules, window) {
        completion.userMapping = function userMapping(context, modes_=[modes.NORMAL], hive=mappings.user) {
            context.keys = { text: function (m) m.names[0],
                             description: function (m) m.description + ": " + m.action };
            context.completions = hive.iterate(modes_);
        };
    },
    javascript: function initJavascript(dactyl, modules, window) {
        JavaScript.setCompleter([Mappings.prototype.get, MapHive.prototype.get],
            [
                null,
                function (context, obj, args) [[m.names, m.description]
                                               for (m in this.iterate(args[0]))]
            ]);
    },
    mappings: function initMappings(dactyl, modules, window) {
        mappings.add([modes.COMMAND],
             ["\\"], "Emits <Leader> pseudo-key",
             function () { events.feedkeys("<Leader>"); });
    }
});

// vim: set fdm=marker sw=4 sts=4 ts=8 et:
