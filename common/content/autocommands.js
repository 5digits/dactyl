// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

var AutoCommand = Struct("event", "filter", "command");
update(AutoCommand.prototype, {
    eventName: Class.memoize(function () this.event.toLowerCase()),

    match: function (event, pattern) {
        return (!event || this.eventName == event.toLowerCase()) && (!pattern || String(this.filter) === pattern);
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
     * Returns all autocommands with a matching *event* and *regexp*.
     *
     * @param {string} event The event name filter.
     * @param {string} pattern The URL pattern filter.
     * @returns {AutoCommand[]}
     */
    get: function (event, pattern) {
        return this._store.filter(function (autoCmd) autoCmd.match(event, regexp));
    },

    /**
     * Deletes all autocommands with a matching *event* and *regexp*.
     *
     * @param {string} event The event name filter.
     * @param {string} regexp The URL pattern filter.
     */
    remove: function (event, regexp) {
        this._store = this._store.filter(function (autoCmd) !autoCmd.match(event, regexp));
    },
});

/**
 * @instance autocommands
 */
var AutoCommands = Module("autocommands", {
    init: function () {
        update(this, {
            hives: contexts.Hives("autocmd", AutoCmdHive),
            user: contexts.hives.autocmd.user
        });
    },

    get activeHives() contexts.initializedGroups("autocmd")
                              .filter(function (h) h._store.length),

    add: deprecated("autocommand.user.add", { get: function add() autocommands.user.closure.add }),
    get: deprecated("autocommand.user.get", { get: function get() autocommands.user.closure.get }),
    remove: deprecated("autocommand.user.remove", { get: function remove() autocommands.user.closure.remove }),

    /**
     * Lists all autocommands with a matching *event* and *regexp*.
     *
     * @param {string} event The event name filter.
     * @param {string} regexp The URL pattern filter.
     */
    list: function (event, regexp) {

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

        commandline.commandOutput(
            <table>
                <tr highlight="Title">
                    <td colspan="3">----- Auto Commands -----</td>
                </tr>
                {
                    template.map(this.activeHives, function (hive)
                        <tr highlight="Title">
                            <td colspan="3">{hive.name}</td>
                        </tr> +
                        <tr style="height: .5ex;"/> +
                        template.map(cmds(hive), function ([event, items])
                            <tr style="height: .5ex;"/> +
                            template.map(items, function (item, i)
                                <tr>
                                    <td highlight="Title" style="padding-right: 1em;">{i == 0 ? event : ""}</td>
                                    <td>{item.filter.toXML ? item.filter.toXML() : item.filter}</td>
                                    <td>{item.command}</td>
                                </tr>) +
                            <tr style="height: .5ex;"/>) +
                        <tr style="height: .5ex;"/>)
                }
            </table>);
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


        dactyl.echomsg('Executing ' + event + ' Auto commands for "*"', 8);

        let lastPattern = null;
        let uri = args.url ? util.newURI(args.url) : buffer.uri;

        event = event.toLowerCase();
        for (let hive in this.hives.iterValues()) {
            let args = update({},
                              hive.argsExtra(arguments[1]),
                              arguments[1]);

            for (let autoCmd in values(hive._store))
                if (autoCmd.eventName === event && autoCmd.filter(uri)) {
                    if (!lastPattern || lastPattern !== String(autoCmd.filter))
                        dactyl.echomsg("Executing " + event + " Auto commands for " + autoCmd.filter, 8);

                    lastPattern = String(autoCmd.filter);
                    dactyl.echomsg("autocommand " + autoCmd.command, 9);

                    dactyl.trapErrors(autoCmd.command, autoCmd, args);
                }
        }
    }
}, {
}, {
    commands: function () {
        commands.add(["au[tocmd]"],
            "Execute commands automatically on events",
            function (args) {
                let [event, regexp, cmd] = args;
                let events = [];

                if (event) {
                    // NOTE: event can only be a comma separated list for |:au {event} {pat} {cmd}|
                    let validEvents = Object.keys(config.autocommands).map(String.toLowerCase);
                    validEvents.push("*");

                    events = Option.parse.stringlist(event);
                    dactyl.assert(events.every(function (event) validEvents.indexOf(event.toLowerCase()) >= 0),
                                  "E216: No such group or event: " + event);
                }

                if (args.length > 2) { // add new command, possibly removing all others with the same event/pattern
                    if (args.bang)
                        args["-group"].remove(event, regexp);
                    cmd = contexts.bindMacro(args, "-ex", function (params) params);
                    args["-group"].add(events, regexp, cmd);
                }
                else {
                    if (event == "*")
                        event = null;

                    if (args.bang) {
                        // TODO: "*" only appears to work in Vim when there is a {group} specified
                        if (args[0] != "*" || args.length > 1)
                            args["-group"].remove(event, regexp); // remove all
                    }
                    else
                        autocommands.list(event, regexp); // list all
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
                        return void dactyl.echomsg("No matching autocommands");

                    let [event, url] = args;
                    let defaultURL = url || buffer.uri.spec;
                    let validEvents = Object.keys(config.autocommands);

                    // TODO: add command validators
                    dactyl.assert(event != "*",
                                  "E217: Can't execute autocommands for ALL events");
                    dactyl.assert(validEvents.indexOf(event) >= 0,
                                  "E216: No such group or event: " + args);
                    dactyl.assert(autocommands.get(event).some(function (c) c.patterns.some(function (re) re.test(defaultURL) ^ !re.result)),
                                  "No matching autocommands");

                    if (this.name == "doautoall" && dactyl.has("tabs")) {
                        let current = tabs.index();

                        for (let i = 0; i < tabs.count; i++) {
                            tabs.select(i);
                            // if no url arg is specified use the current buffer's URL
                            autocommands.trigger(event, { url: url || buffer.uri.spec });
                        }

                        tabs.select(current);
                    }
                    else
                        autocommands.trigger(event, { url: defaultURL });
                }, {
                    argCount: "*", // FIXME: kludged for proper error message should be "1".
                    completer: function (context) completion.autocmdEvent(context),
                    keepQuotes: true
                });
        });
    },
    completion: function () {
        completion.autocmdEvent = function autocmdEvent(context) {
            context.completions = Iterator(config.autocommands);
        };
    },
    javascript: function () {
        JavaScript.setCompleter(autocommands.user.get, [function () Iterator(config.autocommands)]);
    },
    options: function () {
        options.add(["eventignore", "ei"],
            "List of autocommand event names which should be ignored",
            "stringlist", "",
            {
                values: iter(update({ all: "All Events" }, config.autocommands)).toArray(),
                has: Option.has.toggleAll
            });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
