// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

var AutoCommand = Struct("event", "patterns", "command");

/**
 * @instance autocommands
 */
var AutoCommands = Module("autocommands", {
    init: function () {
        this._store = [];
    },

    __iterator__: function () array.iterValues(this._store),

    /**
     * Adds a new autocommand. *cmd* will be executed when one of the specified
     * *events* occurs and the URL of the applicable buffer matches *regexp*.
     *
     * @param {Array} events The array of event names for which this
     *     autocommand should be executed.
     * @param {string} regexp The URL pattern to match against the buffer URL.
     * @param {string} cmd The Ex command to run.
     */
    add: function (events, regexp, cmd) {
        events.forEach(function (event) {
            this._store.push(AutoCommand(event, Option.parse.regexplist(regexp.source || regexp), cmd));
        }, this);
    },

    /**
     * Returns all autocommands with a matching *event* and *regexp*.
     *
     * @param {string} event The event name filter.
     * @param {string} regexp The URL pattern filter.
     * @returns {AutoCommand[]}
     */
    get: function (event, regexp) {
        return this._store.filter(function (autoCmd) AutoCommands.matchAutoCmd(autoCmd, event, regexp));
    },

    /**
     * Deletes all autocommands with a matching *event* and *regexp*.
     *
     * @param {string} event The event name filter.
     * @param {string} regexp The URL pattern filter.
     */
    remove: function (event, regexp) {
        this._store = this._store.filter(function (autoCmd) !AutoCommands.matchAutoCmd(autoCmd, event, regexp));
    },

    /**
     * Lists all autocommands with a matching *event* and *regexp*.
     *
     * @param {string} event The event name filter.
     * @param {string} regexp The URL pattern filter.
     */
    list: function (event, regexp) {
        let cmds = {};

        // XXX
        this._store.forEach(function (autoCmd) {
            if (AutoCommands.matchAutoCmd(autoCmd, event, regexp)) {
                cmds[autoCmd.event] = cmds[autoCmd.event] || [];
                cmds[autoCmd.event].push(autoCmd);
            }
        });

        commandline.commandOutput(
            <table>
                <tr highlight="Title">
                    <td colspan="2">----- Auto Commands -----</td>
                </tr>
                {
                    template.map(cmds, function ([event, items])
                        <tr highlight="Title">
                            <td colspan="2">{event}</td>
                        </tr>
                        +
                        template.map(items, function (item)
                            <tr>
                                <td>&#xa0;{item.patterns}</td>
                                <td>{item.command}</td>
                            </tr>))
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

        let autoCmds = this._store.filter(function (autoCmd) autoCmd.event == event);

        dactyl.echomsg('Executing ' + event + ' Auto commands for "*"', 8);

        let lastPattern = null;
        let url = args.url || "";

        for (let [, autoCmd] in Iterator(autoCmds)) {
            if (autoCmd.patterns.some(function (re) re.test(url) ^ !re.result)) {
                if (!lastPattern || String(lastPattern) != String(autoCmd.patterns))
                    dactyl.echomsg("Executing " + event + " Auto commands for " + autoCmd.patterns, 8);

                lastPattern = autoCmd.patterns;
                dactyl.echomsg("autocommand " + autoCmd.command, 9);

                dactyl.trapErrors(autoCmd.command, autoCmd, args);
            }
        }
    }
}, {
    matchAutoCmd: function (autoCmd, event, regexp) {
        return (!event || autoCmd.event == event) && (!regexp || String(autoCmd.patterns) == regexp);
    }
}, {
    commands: function () {
        commands.add(["au[tocmd]"],
            "Execute commands automatically on events",
            function (args) {
                let [event, regexp, cmd] = args;
                let events = [];

                try {
                    if (args.length > 1)
                        Option.parse.regexplist(regexp);
                }
                catch (e) {
                    dactyl.assert(false, "E475: Invalid argument: " + regexp);
                }

                if (event) {
                    // NOTE: event can only be a comma separated list for |:au {event} {pat} {cmd}|
                    let validEvents = Object.keys(config.autocommands);
                    validEvents.push("*");

                    events = Option.parse.stringlist(event);
                    dactyl.assert(events.every(function (event) validEvents.indexOf(event) >= 0),
                        "E216: No such group or event: " + event);
                }

                if (args.length > 2) { // add new command, possibly removing all others with the same event/pattern
                    if (args.bang)
                        autocommands.remove(event, regexp);
                    cmd = Command.bindMacro(args, "-ex", function (params) params);
                    autocommands.add(events, regexp, cmd);
                }
                else {
                    if (event == "*")
                        event = null;

                    if (args.bang) {
                        // TODO: "*" only appears to work in Vim when there is a {group} specified
                        if (args[0] != "*" || args.length > 1)
                            autocommands.remove(event, regexp); // remove all
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
        JavaScript.setCompleter(autocommands.get, [function () Iterator(config.autocommands)]);
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
