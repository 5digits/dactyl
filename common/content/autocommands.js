// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

var AutoCommand = Struct("event", "filter", "command");
update(AutoCommand.prototype, {
    eventName: Class.Memoize(function () this.event.toLowerCase()),

    match: function (event, pattern) {
        return (!event || this.eventName == event.toLowerCase()) && (!pattern || String(this.filter) === String(pattern));
    }
});

var AutoCmdHive = Class("AutoCmdHive", Contexts.Hive, {
    init: function init(group) {
        init.supercall(this, group);
        this._store = [];
    },

    __iterator__: function () array.iterValues(this._store),

    /**
     * Adds a new autocommand. *cmd* will be executed when one of the specified
     * *events* occurs and the URL of the applicable buffer matches *regexp*.
     *
     * @param {Array} events The array of event names for which this
     *     autocommand should be executed.
     * @param {string} pattern The URL pattern to match against the buffer URL.
     * @param {string} cmd The Ex command to run.
     */
    add: function (events, pattern, cmd) {
        if (!callable(pattern))
            pattern = Group.compileFilter(pattern);

        for (let event in values(events))
            this._store.push(AutoCommand(event, pattern, cmd));
    },

    /**
     * Returns all autocommands with a matching *event* and *filter*.
     *
     * @param {string} event The event name filter.
     * @param {string} filter The URL pattern filter.
     * @returns {[AutoCommand]}
     */
    get: function (event, filter) {
        filter = filter && String(Group.compileFilter(filter));
        return this._store.filter(cmd => cmd.match(event, filter));
    },

    /**
     * Deletes all autocommands with a matching *event* and *filter*.
     *
     * @param {string} event The event name filter.
     * @param {string} filter The URL pattern filter.
     */
    remove: function (event, filter) {
        filter = filter && String(Group.compileFilter(filter));
        this._store = this._store.filter(cmd => !cmd.match(event, filter));
    },
});

/**
 * @instance autocommands
 */
var AutoCommands = Module("autocommands", {
    get activeHives() contexts.allGroups.autocmd.filter(h => h._store.length),

    add: deprecated("group.autocmd.add", { get: function add() autocommands.user.bound.add }),
    get: deprecated("group.autocmd.get", { get: function get() autocommands.user.bound.get }),
    remove: deprecated("group.autocmd.remove", { get: function remove() autocommands.user.bound.remove }),

    /**
     * Lists all autocommands with a matching *event*, *regexp* and optionally
     * *hives*.
     *
     * @param {string} event The event name filter.
     * @param {string} regexp The URL pattern filter.
     * @param {[Hive]} hives List of hives.
     * @optional
     */
    list: function (event, regexp, hives) {
        hives = hives || this.activeHives;

        function cmds(hive) {
            let cmds = {};
            hive._store.forEach(function (autoCmd) {
                if (autoCmd.match(event, regexp)) {
                    cmds[autoCmd.event] = cmds[autoCmd.event] || [];
                    cmds[autoCmd.event].push(autoCmd);
                }
            });
            return cmds;
        }

        let table = (
            ["table", {},
                ["tr", { highlight: "Title" },
                    ["td", { colspan: "3" }, "----- Auto Commands -----"]],
                hives.map(hive => [
                    ["tr", {},
                        ["td", { colspan: "3" },
                            ["span", { highlight: "Title" }, hive.name],
                            " ", hive.filter.toJSONXML(modules)]],
                    ["tr", { style: "height: .5ex;" }],
                    iter(cmds(hive)).map(([event, items]) => [
                        ["tr", { style: "height: .5ex;" }],
                        items.map((item, i) =>
                            ["tr", {},
                                ["td", { highlight: "Title", style: "padding-left: 1em; padding-right: 1em;" },
                                    i == 0 ? event : ""],
                                ["td", {}, item.filter.toJSONXML ? item.filter.toJSONXML(modules) : String(item.filter)],
                                ["td", {}, String(item.command)]]),
                        ["tr", { style: "height: .5ex;" }]]).toArray(),
                    ["tr", { style: "height: .5ex;" }]
                ])]);
        commandline.commandOutput(table);
    },

    /**
     * Triggers the execution of all autocommands registered for *event*. A map
     * of *args* is passed to each autocommand when it is being executed.
     *
     * @param {string} event The event to fire.
     * @param {Object} args The args to pass to each autocommand.
     */
    trigger: function (event, args) {
        if (options.get("eventignore").has(event))
            return;

        dactyl.echomsg(_("autocmd.executing", event, "*".quote()), 8);

        let lastPattern = null;
        var { url, doc } = args;
        if (url)
            uri = util.createURI(url);
        else
            var { uri, doc } = buffer;

        event = event.toLowerCase();
        for (let hive in values(this.matchingHives(uri, doc))) {
            let args = hive.makeArgs(doc, null, arguments[1]);

            for (let autoCmd in values(hive._store))
                if (autoCmd.eventName === event && autoCmd.filter(uri, doc)) {
                    if (!lastPattern || lastPattern !== String(autoCmd.filter))
                        dactyl.echomsg(_("autocmd.executing", event, autoCmd.filter), 8);

                    lastPattern = String(autoCmd.filter);
                    dactyl.echomsg(_("autocmd.autocommand", autoCmd.command), 9);

                    dactyl.trapErrors(autoCmd.command, autoCmd, args);
                }
        }
    }
}, {
}, {
    contexts: function initContexts() {
        update(AutoCommands.prototype, {
            hives: contexts.Hives("autocmd", AutoCmdHive),
            user: contexts.hives.autocmd.user,
            allHives: contexts.allGroups.autocmd,
            matchingHives: function matchingHives(uri, doc) contexts.matchingGroups(uri, doc).autocmd
        });
    },
    commands: function initCommands() {
        commands.add(["au[tocmd]"],
            "Execute commands automatically on events",
            function (args) {
                let [event, filter, cmd] = args;
                let events = [];

                if (event) {
                    // NOTE: event can only be a comma separated list for |:au {event} {pat} {cmd}|
                    let validEvents = Object.keys(config.autocommands).map(String.toLowerCase);
                    validEvents.push("*");

                    events = Option.parse.stringlist(event);
                    dactyl.assert(events.every(e => validEvents.indexOf(e.toLowerCase()) >= 0),
                                  _("autocmd.noGroup", event));
                }

                if (args.length > 2) { // add new command, possibly removing all others with the same event/pattern
                    if (args.bang)
                        args["-group"].remove(event, filter);
                    cmd = contexts.bindMacro(args, "-ex", params => params);
                    args["-group"].add(events, filter, cmd);
                }
                else {
                    if (event == "*")
                        event = null;

                    if (args.bang) {
                        // TODO: "*" only appears to work in Vim when there is a {group} specified
                        if (args[0] != "*" || args.length > 1)
                            args["-group"].remove(event, filter); // remove all
                    }
                    else
                        autocommands.list(event, filter, args.explicitOpts["-group"] ? [args["-group"]] : null); // list all
                }
            }, {
                bang: true,
                completer: function (context, args) {
                    if (args.length == 1)
                        return completion.autocmdEvent(context);
                    if (args.length == 3)
                        return args["-javascript"] ? completion.javascript(context) : completion.ex(context);
                },
                hereDoc: true,
                keepQuotes: true,
                literal: 2,
                options: [
                    contexts.GroupFlag("autocmd"),
                    {
                        names: ["-javascript", "-js"],
                        description: "Interpret the action as JavaScript code rather than an Ex command"
                    }
                ]
            });

        [
            {
                name: "do[autocmd]",
                description: "Apply the autocommands matching the specified URL pattern to the current buffer"
            }, {
                name: "doautoa[ll]",
                description: "Apply the autocommands matching the specified URL pattern to all buffers"
            }
        ].forEach(function (command) {
            commands.add([command.name],
                command.description,
                // TODO: Perhaps this should take -args to pass to the command?
                function (args) {
                    // Vim compatible
                    if (args.length == 0)
                        return void dactyl.echomsg(_("autocmd.noMatching"));

                    let [event, url] = args;
                    let uri = util.createURI(url) || buffer.uri;
                    let validEvents = Object.keys(config.autocommands);

                    // TODO: add command validators
                    dactyl.assert(event != "*",
                                  _("autocmd.cantExecuteAll"));
                    dactyl.assert(validEvents.indexOf(event) >= 0,
                                  _("autocmd.noGroup", args));
                    dactyl.assert(autocommands.get(event).some(c => c.filter(uri)),
                                  _("autocmd.noMatching"));

                    if (this.name == "doautoall" && dactyl.has("tabs")) {
                        let current = tabs.index();

                        for (let i = 0; i < tabs.count; i++) {
                            tabs.select(i);
                            // if no url arg is specified use the current buffer's URL
                            autocommands.trigger(event, { url: uri.spec });
                        }

                        tabs.select(current);
                    }
                    else
                        autocommands.trigger(event, { url: uri.spec });
                }, {
                    argCount: "*", // FIXME: kludged for proper error message should be "1".
                    completer: function (context) completion.autocmdEvent(context),
                    keepQuotes: true
                });
        });
    },
    completion: function initCompletion() {
        completion.autocmdEvent = function autocmdEvent(context) {
            context.completions = Iterator(config.autocommands);
        };
    },
    javascript: function initJavascript() {
        JavaScript.setCompleter(AutoCmdHive.prototype.get, [() => Iterator(config.autocommands)]);
    },
    options: function initOptions() {
        options.add(["eventignore", "ei"],
            "List of autocommand event names which should be ignored",
            "stringlist", "",
            {
                values: iter(update({ all: "All Events" }, config.autocommands)).toArray(),
                has: Option.has.toggleAll
            });
    }
});

// vim: set fdm=marker sw=4 sts=4 ts=8 et:
