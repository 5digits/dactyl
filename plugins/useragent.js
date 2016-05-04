"use strict";
var INFO =
["plugin", { name: "useragent",
             version: "0.3",
             href: "http://dactyl.sf.net/pentadactyl/plugins#useragent-plugin",
             summary: "User Agent Switcher",
             xmlns: "dactyl" },
    ["author", { email: "maglione.k@gmail.com" },
        "Kris Maglione"],
    ["license", { href: "http://opensource.org/licenses/mit-license.php" },
        "MIT"],
    ["project", { name: "Pentadactyl", "min-version": "1.0" }],
    ["p", {},
        "Ths plugin allows you to switch the browser's reported user-agent to a ",
        "number of preset values."],
    ["item", {},
        ["tags", {}, ":ua :useragent"],
        ["spec", {}, ":useragent ", ["oa", {}, "name"], " ", ["oa", {}, "useragent"]],
        ["description", {},
            ["p", {},
                "With zero or one arguments, list the currently defined ",
                "user-agent values."],

            ["p", {},
                "With two arguments, defines a new user-agent for use in the ",
                ["o", {}, "useragent"], " option. When ", ["o", {}, "useragent"], " is set to ",
                "", ["oa", {}, "name"], ", the ", ["tt", {}, "User-Agent"], " value sent to web ",
                "servers, and the value returned by ",
                ["tt", {}, "navigator.userAgent"], " will be ", ["oa", {}, "useragent"], ". ",
                "Additionally, the following options are available:"],

            ["dl", {},
                ["dt", {}, "-appcodename"], ["dd", {}, "The value of ", ["tt", {}, "navigator.appCodeName"]],
                ["dt", {}, "-appname"],     ["dd", {}, "The value of ", ["tt", {}, "navigator.appName"]],
                ["dt", {}, "-appversion"],  ["dd", {}, "The value of ", ["tt", {}, "navigator.appVersion"]],
                ["dt", {}, "-platform"],    ["dd", {}, "The value of ", ["tt", {}, "navigator.platform"]],
                ["dt", {}, "-vendor"],      ["dd", {}, "The value of ", ["tt", {}, "navigator.vendor"]],
                ["dt", {}, "-vendorsub"],   ["dd", {}, "The value of ", ["tt", {}, "navigator.vendorsub"]]]]],

    ["item", {},
        ["tags", {}, ":deluseragent :delua"],
        ["spec", {}, ":deluseragent ", ["a", {}, "name"]],
        ["description", {},
            ["p", {},
                "Deletes a useragent created by ", ["ex", {}, ":useragent"], "."]]],

    ["item", {},
        ["tags", {}, "'useragent' 'ua'"],
        ["spec", {}, "'useragent' 'ua'"],
        ["description", {},
            ["p", {},
                "Changes the User-Agent string sent to the web server and ",
                "returned by ", ["tt", {}, "navigator.userAgent"], ". If the value is the ",
                "name of a user-agent defined by ", ["ex", {}, ":useragent"], ", or one of ",
                "the predefined values, then the defined value is used. ",
                "Otherwise, the value itself is used."]]]];

let UserAgent, useragents;
let init = function init_() {
    init = function () {};

    UserAgent = Struct("name", "useragent", "appname", "appcodename",
                           "appversion", "platform", "vendor", "vendorsub", "userset");

    Object.defineProperty(UserAgent.prototype, "options", {
        get() {
            return opts.slice(1).map(opt => [opt.name, this[opt.name]])
                       .filter(opt => opt[1]);
        },
        enumerable: true,
        configurable: true
    });

    useragents = array([
        // From User Agent Switcher 0.7.2
        ["ie-6", "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)",
            "Mozilla", "Microsoft Internet Explorer", "4.0 (compatible; MSIE 6.0; Windows NT 5.1)",
            "Win32"],
        ["ie-7", "Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 6.0)",
            "Mozilla", "Microsoft Internet Explorer", "4.0 (compatible; MSIE 7.0; Windows NT 6.0)",
            "Win32"],
        ["ie-8", "Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 6.1)",
            "Mozilla", "Microsoft Internet Explorer", "4.0 (compatible; MSIE 8.0; Windows NT 6.1)",
            "Win32"],
        ["bot-googlebot-2.1", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
        ["bot-msnbot-1.1", "msnbot/1.1 (+http://search.msn.com/msnbot.htm)"],
        ["bot-yahoo", "Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)"],
        ["iphone-3", "Mozilla/5.0 (iPhone; U; CPU iPhone OS 3_0 like Mac OS X; en-us) AppleWebKit/528.18 (KHTML, like Gecko) Version/4.0 Mobile/7A341 Safari/528.16",
            "Mozilla", "Netscape", "5.0 (iPhone; U; CPU iPhone OS 3_0 like Mac OS X; en-us) AppleWebKit/528.18 (KHTML, like Gecko) Version/4.0 Mobile/7A341 Safari/528.16",
            "iPhone", "Apple Computer, Inc.", ""]
    ]).map(ua => [ua[0], UserAgent.fromArray(ua)]).toObject();
};

let Opt = Struct("name", "description", "pref", "names");
Opt.defaultValue("names", function () { return ["-" + this.name]; });
let opts = [
    ["useragent",   "The value of navigator.userAgent",   "general.useragent.override"],
    ["appcodename", "The value of navigator.appCodeName", "general.useragent.appName"],
    ["appname",     "The value of navigator.appName",     "general.appname.override"],
    ["appversion",  "The value of navigator.appVersion",  "general.appversion.override"],
    ["platform",    "The value of navigator.platform",    "general.platform.override"],
    ["vendor",      "The value of navigator.vendor",      "general.useragent.vendor"],
    ["vendorsub",   "The value of navigator.vendorsub",   "general.useragent.vendorSub"]
].map(Opt.fromArray, Opt);

group.options.add(["useragent", "ua"],
    "The current browser user-agent",
    "string", "default",
    {
        initValue: function () {},
        completer: function (context, args) {
            init();

            context.title = ["Name", "User-Agent"];
            context.keys = { text: "name", description: "useragent" };
            context.completions = array(values(useragents)).concat(
                [{ name: "default", useragent: navigator.userAgent }]);
        },
        setter: function (value) {
            init();

            let ua = useragents[value] ||
                (value == "default" ? UserAgent("default")
                                    : UserAgent("", value));
            for (let opt of values(opts)) {
                if (ua[opt.name])
                    prefs.safeSet(opt.pref, ua[opt.name], "See the 'useragent' option");
                else
                    prefs.safeReset(opt.pref, "See the 'useragent' option");
            }
            return value;
        },
        validator: () => true,
    });

group.commands.add(["useragent", "ua"],
    "Define a new useragent.",
    function (args) {
        init();

        if (args.length < 2)
            commandline.commandOutput(template.tabular(["Name", "User-Agent"], ["padding-right: 1em; min-width: 8em;", "white-space: normal;"],
                [[ua.name,
                  ["",
                    ua.useragent,
                    !ua.options.length ? "" :
                    ["span", { highlight: "URLExtra" },
                        " (",
                        template.map(ua.options, (o) =>
                            [["span", { highlight: "Key Normal" }, o[0]],
                             "=",
                             ["span", { highlight: "String" }, o[1]]],
                            "\u00a0"),
                        ")"]]
                 ]
                 for (ua of values(useragents))
                 if (!args[0] || ua.name.indexOf(args[0]) >= 0)]));
        else {
            dactyl.assert(args.bang || !Set.has(useragents, args[0]),
                          "Useragent " + JSON.stringify(args[0]) + " already exists");
            useragents[args[0]] = UserAgent.fromArray(
                args.concat(opts.slice(1).map(
                    (opt) => args[opt.names[0]])));
            useragents[args[0]].userset = true;
        }
    }, {
        bang: true,
        completer: function (context, args) {
            init();

            if (args.completeArg == 1)
                context.completions = [[navigator.userAgent, "Default"]].concat(
                    [[v.useragent, k] for ([k, v] of iter(useragents))]);
        },
        literal: 1,
        options: opts.slice(1).map((opt) => ({
            names: opt.names,
            description: opt.description,
            completer: (context, args) =>
                array(values(useragents)).map((ua) => ua[opt.name])
                                         .compact().uniq()
                                         .map((val) => [val, ""]).array,
            type: CommandOption.STRING
        })),
        serialize: function () {
            init();
            return [
                {
                    command: this.name,
                    arguments: [ua.name],
                    bang: true,
                    literalArg: ua.useragent,
                    options: array(
                        [opt.names[0], ua[opt.name]]
                        for (opt of values(opts.slice(1)))
                        if (ua[opt.name] != null)
                    ).toObject()
                }
                for (ua of values(useragents)) if (ua.userset)
            ]
        }
    }, true);

group.commands.add(["deluseragent", "delua"],
    "Deletes a useragent.",
    function (args) {
        init();

        dactyl.assert(Set.has(useragents, args[0]), "Invalid argument");
        if (options["useragent"] == args[0])
            options["useragent"] = "default";
        delete useragents[args[0]];
    }, {
        argCount: "1"
    }, true);

/* vim:se sts=4 sw=4 et: */
