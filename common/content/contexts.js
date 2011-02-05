// Copyright (c) 2010-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var Group = Class("Group", {
    init: function init(name, description, filter, persist) {
        const self = this;
        this.name = name;
        this.description = description;
        this.filter = filter || function (uri) true;
        this.persist = persist || false;
    },

    get toStringParams() [this.name],

    get builtin() contexts.builtinGroups.indexOf(this) >= 0,

    subGroups: {}

}, {
    subGroup: {},

    subGroups: {},

    SubGroup: Class("SubGroup", Class.Property, {
        init: function init(name, constructor) {
            const self = this;
            if (this.Group)
                return {
                    enumerable: true,

                    get: function () array(contexts.groups[self.name])
                };


            this.Group = constructor;
            this.name = name;
            memoize(Group.prototype, name,
                    function () constructor(this.name, this.description,
                                            this.filter, this.persist));

            memoize(Group.subGroup, name,
                    function () Object.create({ _subGroup: name, __proto__: contexts.subGroupProto }));

            memoize(Group.subGroups, name,
                    function () [group[name] for (group in values(this.groups)) if (set.has(group, name))]);
        }
    })
});

var Contexts = Module("contexts", {
    init: function () {
        this.groupList = [];
        this.groupMap = {};
        this.subGroupProto = {};

        this.system = this.addGroup("builtin", "Builtin items");
        this.user = this.addGroup("user", "User-defined items", null, true);
        this.builtinGroups = [this.system, this.user];
    },

    context: null,

    groups: Class.memoize(function () ({
        __proto__: Group.subGroups,
        groups: this.groupList.filter(function (g) g.filter(buffer.uri))
    })),

    allGroups: Class.memoize(function () ({
        __proto__: Group.subGroups,
        groups: this.groupList
    })),

    get subGroup() Group.subGroup,

    addGroup: function addGroup(name, description, filter, persist) {
        this.removeGroup(name);

        let group = Group(name, description, filter, persist);
        this.groupList.unshift(group);
        this.groupMap[name] = group;
        this.subGroupProto.__defineGetter__(name, function () group[this._subGroup]);
        return group;
    },

    removeGroup: function removeGroup(name, filter) {
        let group = this.getGroup(name);
        dactyl.assert(!group || !group.builtin, "Cannot remove builtin group");

        if (group)
            this.groupList.splice(this.groupList.indexOf(group), 1);

        if (this.context && this.context.group === group)
            this.context.group = null;

        delete this.groupMap[name];
        delete this.subGroupProto[name];
        delete this.groups;
        return group;
    },

    getGroup: function getGroup(name, subGroup) {
        let group = array.nth(this.groupList, function (h) h.name == name, 0) || null;
        if (group && subGroup)
            return group[subGroup];
        return group;
    },

    bindMacro: function (args, default_, params) {
        let process = util.identity;

        if (callable(params))
            var makeParams = function makeParams(self, args)
                iter.toObject([k, process(v)]
                               for ([k, v] in iter(params.apply(self, args))));
        else if (params)
            makeParams = function makeParams(self, args)
                iter.toObject([name, process(args[i])]
                              for ([i, name] in Iterator(params)));

        let rhs = args.literalArg;
        let type = ["-builtin", "-ex", "-javascript", "-keys"].reduce(function (a, b) args[b] ? b : a, default_);
        switch (type) {
        case "-builtin":
            let noremap = true;
            /* fallthrough */
        case "-keys":
            let silent = args["-silent"];
            rhs = events.canonicalKeys(rhs, true);
            var action = function action() events.feedkeys(action.macro(makeParams(this, arguments)),
                                                           noremap, silent);
            action.macro = util.compileMacro(rhs, true);
            break;
        case "-ex":
            action = function action() commands.execute(action.macro, makeParams(this, arguments),
                                                        false, null, action.context);
            action.macro = util.compileMacro(rhs, true);
            action.context = this.context && update({}, this.context);
            break;
        case "-javascript":
            if (callable(params))
                action = dactyl.userEval("(function action() { with (action.makeParams(this, arguments)) {" + args.literalArg + "} })");
            else
                action = dactyl.userFunc.apply(dactyl, params.concat(args.literalArg).array);
            process = function (param) isObject(param) && param.valueOf ? param.valueOf() : param;
            action.makeParams = makeParams;
            break;
        }
        action.toString = function toString() (type === default_ ? "" : type + " ") + rhs;
        args = null;
        return action;
    }
}, {
}, {
    commands: function initCommands() {

        commands.add(["gr[oup]", "mapg[roup]"],
            "Create or select a group",
            function (args) {
                dactyl.assert(args.length <= 2, "Trailing characters");

                if (args.length == 0)
                    return void completion.listCompleter("group", "");

                let name = Option.dequote(args[0]);
                dactyl.assert(commands.validName.test(name), "Invalid group name");

                let group = contexts.getGroup(name);

                if (args.length == 2) {
                    dactyl.assert(!group || args.bang, "Group exists");

                    let filter = function siteFilter(uri)
                        siteFilter.filters.every(function (f) f(uri) == f.result);

                    update(filter, {
                        toString: function () this.filters.join(","),
                        filters: Option.splitList(args[1], true).map(function (pattern) {
                            let [, res, filter] = /^(!?)(.*)/.exec(pattern);

                            return update(Styles.matchFilter(Option.dequote(filter)), {
                                result: !res,
                                toString: function () pattern
                            });
                        })
                    });

                    group = contexts.addGroup(name, args["-description"], filter, !args["-nopersist"]);
                }

                dactyl.assert(group, "No such group: " + name);
                dactyl.assert(group.name != "builtin", "Cannot modify builtin group");
                if (args.context)
                    args.context.group = group;
            },
            {
                argCount: "*",
                bang: true,
                completer: function (context, args) {
                    if (args.length == 1)
                        completion.group(context);
                    else {
                        Option.splitList(context.filter);
                        context.advance(Option._splitAt);

                        context.compare = CompletionContext.Sort.unsorted;
                        context.completions = [
                            [buffer.uri.host, "Current Host"],
                            [buffer.uri.spec, "Current Page"]
                        ];
                    }
                },
                keepQuotes: true,
                options: [
                    {
                        names: ["-description", "-desc", "-d"],
                        description: "A description of this group",
                        type: CommandOption.STRING
                    },
                    {
                        names: ["-nopersist", "-n"],
                        description: "Do not save this group to an auto-generated RC file"
                    }
                ]
            });

        commands.add(["delg[roup]", "delmapg[roup]"],
            "Delete a group",
            function (args) {
                dactyl.assert(contexts.getGroup(args[0]), "No such group: " + args[0]);
                contexts.removeGroup(args[0]);
            },
            {
                argCount: "1",
                completer: function (context, args) {
                    completion.group(context);
                    context.filters.push(function ({ item }) !item.builtin);
                }
            });


        commands.add(["fini[sh]"],
            "Stop sourcing a script file",
            function (args) {
                dactyl.assert(args.context, "E168: :finish used outside of a sourced file");
                args.context.finished = true;
            },
            { argCount: "0" });


        function checkStack(cmd) {
            util.assert(contexts.context && contexts.context.stack &&
                        contexts.context.stack[cmd] && contexts.context.stack[cmd].length,
                        "Invalid use of conditional");
        }
        function pop(cmd) {
            checkStack(cmd);
            return contexts.context.stack[cmd].pop();
        }
        function push(cmd, value) {
            util.assert(contexts.context, "Invalid use of conditional");
            if (arguments.length < 2)
                value = contexts.context.noExecute;
            contexts.context.stack = contexts.context.stack || {};
            contexts.context.stack[cmd] = (contexts.context.stack[cmd] || []).concat([value]);
        }

        commands.add(["if"],
            "Execute commands until the next :elseif, :else, or :endif only if the argument returns true",
            function (args) { args.context.noExecute = !dactyl.userEval(args[0]); },
            {
                always: function (args) { push("if"); },
                argCount: "1",
                literal: 0
            });
        commands.add(["elsei[f]", "elif"],
            "Execute commands until the next :elseif, :else, or :endif only if the argument returns true",
            function (args) {},
            {
                always: function (args) {
                    checkStack("if");
                    args.context.noExecute = args.context.stack.if.slice(-1)[0] ||
                        !args.context.noExecute || !dactyl.userEval(args[0]);
                },
                argCount: "1",
                literal: 0
            });
        commands.add(["el[se]"],
            "Execute commands until the next :endif only if the previous conditionals were not executed",
            function (args) {},
            {
                always: function (args) {
                    checkStack("if");
                    args.context.noExecute = args.context.stack.if.slice(-1)[0] ||
                        !args.context.noExecute;
                },
                argCount: "0"
            });
        commands.add(["en[dif]", "fi"],
            "End a string of :if/:elseif/:else conditionals",
            function (args) {},
            {
                always: function (args) { args.context.noExecute = pop("if"); },
                argCount: "0"
            });
    },
    completion: function initCompletion() {
        completion.group = function group(context, modes) {
            context.title = ["Group"];
            context.keys = { text: "name", description: function (h) h.description || h.filter };
            context.completions = contexts.groupList.slice(0, -1);
        };
    }
});

