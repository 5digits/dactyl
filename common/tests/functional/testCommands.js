// Runs a slew of generic command tests

var dactyllib = require("dactyl");

var setupModule = function (module) {
    controller = mozmill.getBrowserController();
    dactyl = new dactyllib.Controller(controller);

    dactyl.dactyl.options["autocomplete"] = [];
    dactyl.dactyl.options["wildmode"] = ["list"];

    dactyl.dactyl.prefs.set("browser.tabs.closeWindowWithLastTab", false);
};
var teardownModule = function (module) {
    dactyl.teardown();
}

var tests = {
    "!": {
        multiOutput: ["echo foo"]
    },
    abbreviate: {
        someOutput: ["", "abc"],
        noOutput: ["abc def", "-js abc def"],
        completions: ["", "abc ", "-js abc "]
    },
    abclear: {
        noOutput: [""]
    },
    addons: {
        multiOutput: ["", "dactyl", "-type=extension", "-type=extension dactyl"]
    },
    autocmd: {
        multiOutput: ["", "DOMLoad", "DOMLoad foo"],
        noOutput: ["DOMLoad foo bar", "-js DOMLoad foo bar"],
        completions: ["", "DOMLoad foo ", "-js DOMLoad foo "]
    },
    back: { noOutput: [""] },
    bdelete: {
        init: ["tabopen about:pentadactyl", "tabopen about:pentadactyl"],
        noOutput: [""],
        anyOutput: ["about:pentadactyl"]
    },
    bmark: {
        someOutput: ["bmark", "bmark -tags=foo -titlt=bar -keyword=baz -charset=UTF-8 -post=quux about:pentadactyl"],
        error: ["bmark -tags=foo -titlt=bar -keyword=baz -charset=nonExistentCharset -post=quux about:pentadactyl"],
        completions: [
            "-max=1 -keyword=",
            "-max=1 -keyword=foo -tags=",
            "-max=1 -keyword=foo -tags=bar -title=",
            "-max=1 -keyword=foo -tags=bar -title=baz -charset=",
            "-max=1 -keyword=foo -tags=bar -title=baz -charset= about:"
        ]
    },
    bmarks: {
        multiOutput: ["-max=1", "-max=1 -keyword=foo -tags=bar -title=baz about:pentadactyl"],
        completions: [
            "-max=1 -keyword=",
            "-max=1 -keyword=foo -tags=",
            "-max=1 -keyword=foo -tags=bar -title=",
            "-max=1 -keyword=foo -tags=bar -title=baz about:"
        ]
    },
    buffer: {
        anyOutput: ["", "1"],
        noOutput: ["!", "! 1"],
        completions: ["", "1"]
    },
    buffers: {
        multiOutput: ["", "1"],
        completions: ["", "1"]
    },
    cd: {
        lineOutput: ["", "~/"],
        completions: ["", "~/"]
    },
    colorscheme: {
        error: ["", "some-non-existent-scheme"]
    },
    command: {
        init: ["comclear"],
        lineOutput: ["", "foobar"],
        noOutput: ["foo bar", "-js bar baz"],
        multiOutput: [""],
        error: ["foo bar", "-js bar baz"]
    },
    comclear: {
        noOutput: [""]
    },
    contexts: {}, // Not testable in this manner
    cookies: {
        anyOutput: ["dactyl.sf.net", "dactyl.sf.net list"],
        error: [""],
        completions: ["", "dactyl.sf.net "]
    },
    delbmarks: { anyOutput: ["", "about:pentadactyl"] },
    delcommand: {
        noOutput: ["foo"]
    },
    delmacros: {
        error: [""],
        noOutput: ["x"],
        completions: ["", "x"]
    },
    delmapgroup: {}, // Skip for now
    get delmarks() this.delmacros,
    get delqmarks() this.delmacros,
    delstyle: {
        completions: ["", "-name=", "-name=foo ", "-index=", "-index="]
    },
    dialog: {
        // Skip implementation for now
        completions: ["", "pre"]
    },
    doautoall: {}, // Skip for now
    doautocmd: {}, // Skip for now
    downloads: {
        multiOutput: ["", "dactyl", "dactyl"]
    },
    echo: {
        singleOutput: ["' - '"],
        multiOutput: ["'\\n'", "window"],
        completions: [
            "",
            "window",
            "window.",
            "window['",
            "commands.get('"
        ]
    },
    get echoerr() ({
        errorsOk: true,
        __proto__: this.echo,
    }),
    get echomsg() this.echo,
    else: {}, // Skip for now
    elseif: {}, // Skip for now
    emenu: {
        noOutput: ["View.Zoom.Zoom In", "View.Zoom.Zoom Out"],
        error: [""],
        completions: ["", "View."]
    },
    endif: {}, // Skip for now
    execute: {
        noOutput: ["", "'js " + "".quote() + "'"],
        someOutput: ["'ls'"]
    },
    extadd: { error: [""] },
    extdelete: { error: [""] },
    extdisable: { error: [""] },
    extenable: { error: [""] },
    extoptions: { error: [""] },
    extrehash: { error: [""] },
    exttoggle: { error: [""] },
    extupdate: { error: [""] },
    feedkeys: {
        noOutput: ["<Exc>"],
        error: [""]
    },
    finish: { noOutput: [""] },
    forward: { noOutput: [""] },
    frameonly: { noOutput: [""] },
    hardcopy: {}, // Skip for now
    help: {
        noOutput: ["", "intro"],
        cleanup: ["tabdelete", "tabdelete"],
        completions: ["", "'wild"]
    },
    get helpall() this.help,
    highlight: {
        multiOutput: ["", "Help"],
        noOutput: [
            "Help foo: bar;",
            "Help -group=FontCode",
            "Help -group=FontCode foo: bar;"
        ],
        completions: [
            "",
            "Help",
            "Help ",
            "Help -group=",
            "Help -group=FontCode ",
            "Help foo: bar; -moz"
        ]
    },
    history: {
        anyOutput: ["-max=1", "-max=1 -sort=+date", "-max=1 dactyl"],
        completions: [
            "",
            "dactyl",
            "-sort=+",
            "-sort=-",
            "-sort=+date ",
            "-sort=+date dactyl"
        ]
    },
    if: {}, // Skip for now
    javascript: {
        noOutput: ["''", "'\\n'", "<pre>foo bar</pre>", "window"],
        completions: [
            "",
            "window",
            "window.",
            "window['",
            "commands.get('"
        ]
    },
    jumps: {
        multiOutput: [""]
    },
    keepalt: {
        error: [""],
        noOutput: ["js ''"],
        anyOutput: ["echo 'foo'"]
    },
    let: {}, // Deprecated. Fuck it.
    listcommands: {
        anyOutput: ["", "in"],
        completions: ["", "in "]
    },
    get listkeys() this.listcommands,
    get listoptions() this.listcommands,
    loadplugins: {},
    macros: {
        multiOutput: [""],
        complete: [""]
    },
    map: {
        multiOutput: ["", "i"],
        noOutput: [
            "i j",
            "-builtin i j",
            "-group=user -b i j",
            "-js i j()",
            "-ex i :j",
            "-silent i :j",
            "-mode=ex -b <C-a> <C-a>"
        ],
        error: [
            "-mode=some-nonexistent-mode <C-a> <C-a>",
            "-gtroup=some-nonexistent-group <C-a> <C-a>"
        ],
        complete: [
            "",
            "-",
            "-mode=ex ",
            "-mode=",
            "-group=",
            "-builtin i ",
            "-ex i ",
            "-javascript i ",
        ]
    },
    mapclear: {
        noOutput: [""],
        complete: [""]
    },
    mapgroup: {
        multiOutput: [""],
        noOutput: [
            "foo -d='foo group' -nopersist 'bar.com,http://bar/*,http://bar,^http:'",
            "! foo -d='foo group' -nopersist 'bar.com,http://bar/*,http://bar,^http:'",
            "foo",
            "user"
        ],
        error: [
            "some-nonexistent-group",
            "foo -d='foo group' -nopersist 'bar.com,http://bar/*,http://bar,^http:'"
        ],
        complete: [
            "",
            "foo "
        ],
        cleanup: ["delmapgroup foo"]
    },
    mark: {
        error: ["", "#", "xy"],
        noOutput: ["y"],
        complete: [""]
    },
    marks: {
        init: ["delmarks q"],
        multiOutput: ["", "y"],
        error: ["q", "#"],
        complete: [""]
    },
    messages: {
        anyOutput: ["messages"]
    },
    messclear: {
        error: ["q"],
        noOutput: [""]
    },
    mkpentadactylrc: {
        noOutput: [
            "some-nonexistent-rc.penta",
            "! some-nonexistent-rc.penta"
        ],
        error: ["some-nonexistent-rc.penta"],
        complete: [""],
        cleanup: ["silent !rm some-nonexistent-rc.penta"]
    },
    mksyntax: {
        noOutput: [
            "some-nonexistent-pentadactyl-dir/",
            "! some-nonexistent-pentadactyl-dir/",
            "some-nonexistent-pentadactyl-dir/foo.vim",
            "! some-nonexistent-pentadactyl-dir/foo.vim",
        ],
        error: [
            "some-nonexistent-pentadactyl-dir/",
            "some-nonexistent-pentadactyl-dir/foo.vim"
        ],
        complete: [""],
        cleanup: ["silent !rm -r some-nonexistent-pentadactyl-dir/"]
    },
    normal: {
        noOutput: ["<Nop>"],
        lineOutput: ["<C-g>"],
        multiOutput: ["g<C-g>"]
    },
    open: {
        noOutput: ["about:blank | about:home"],
        complete: [
            "",
            "./",
            "./ | ",
            "chrome://",
            "chrome://browser/",
            "chrome://browser/content/",
            "about:",
            "resource://",
            "resource://dactyl/"
        ]
    },
    pageinfo: {
        multiOutput: ["", "fgm"],
        complete: [""],
        error: ["abcdefghijklmnopqrstuvwxyz", "f g m"]
    },
    pagestyle: {
        complete: [""]
    },
    preferences: {}, // Skip for now
    pwd: {
        singleOutput: [""]
    },
    qmark: {
        lineOutput: [
            "m",
            "m foo bar"
        ],
        error: ["", "#"],
        complete: ["", "m "]
    },
    qmarks: {
        // init: ["delqmarks a-zA-Z0-9"],
        // error: ["", "x"],
        init: ["qmark x"],
        multiOutput: ["", "m", "x"],
        complete: [""]
    },
    quit: {}, // Skip for now
    quitall: {}, // Skip for now
    redraw: {
        noOutput: [""]
    },
    rehash: {}, // Skip for now
    reload: {
        noOutput: [""]
    },
    reloadall: {
        noOutput: [""]
    },
    restart: {}, // Skip
    runtime: {
        init: [
            "js File('~/.pentadactyl/some-nonexistent/good.css').write('')",
            "js File('~/.pentadactyl/some-nonexistent/good.js').write('')",
            "js File('~/.pentadactyl/some-nonexistent/bad.js').write('dactyl.echoerr(\"error\")')",
            "js File('~/.pentadactyl/some-nonexistent/good.penta').write('')",
            "js File('~/.pentadactyl/some-nonexistent/bad.penta').write('echoerr \"error\"')",
        ],
        cleanup: ["js File('~/.pentadactyl/some-nonexistent').remove(true)"],
        noOutput: [
            "some-nonexistent/good.css",
            "some-nonexistent/good.js",
            "some-nonexistent/good.penta"
        ],
        errors: [
            "some-nonexistent/bad.js",
            "some-nonexistent/bad.penta"
        ],
        singleOutput: ["some-nonexistent-file.js"],
        complete: [
            "",
            "plugins/",
            "info/"
        ]
    },
    sanitize: {},
    saveas: {},
    sbclose: {
        noOutput: [""]
    },
    scriptnames: {},
    set: {},
    get setglobal() this.set,
    get setlocal() this.set,
    sidebar: {
        error: ["!", ""],
        noOutput: [
            "! Add-ons",       "Add-ons",       "! Add-ons",
            "! Bookmarks",     "Bookmarks",     "! Bookmarks",
            "! Console",       "Console",       "! Console",
            "! Downloads",     "Downloads",     "! Downloads",
            "! History",       "History",       "! History",
            "! Preferences",   "Preferences",   "! Preferences",
            // "!" Previous sidebar isn't saved until the window loads.
            //     We don't give it enough time.
        ],
        completions: ["", "! "]
    },
    silent: {
        noOutput: [
            "echo 'foo'",
            "echo " + "foo\nbar".quote(),
            "echoerr 'foo'",
            "echoerr " + "foo\nbar".quote()
        ],
        completions: [""]
    },
    source: {},
    stop: {},
    stopall: {},
    style: {},
    styledisable: {},
    styleenable: {},
    styletoggle: {},
    tab: {},
    tabattach: {},
    tabdetach: {},
    tabdo: {},
    tabduplicate: {},
    tablast: {},
    tabmove: {},
    tabnext: {},
    tabonly: {},
    tabopen: {},
    tabprevious: {},
    tabrewind: {},
    time: {},
    toolbarhide: {},
    toolbarshow: {},
    toolbartoggle: {},
    tunmap: {},
    unabbreviate: {},
    undo: {},
    undoall: {},
    unlet: {},
    unmap: {},
    verbose: {},
    version: {},
    viewsource: {},
    winclose: {},
    window: {},
    winonly: {},
    winopen: {},
    wqall: {},
    yank: {},
    zoom: {}
};

var global = this;
function addTest(cmdName, testName, func) {
    global["testCommand_" + cmdName + "_" + testName] = func;
}

function runCommands(cmdName, testName, commands, test, forbidErrors) {
    addTest(cmdName, testName, function () {
        commands.forEach(function (cmd) {
            // dump("CMD: " + cmdName + " " + cmd + "\n");
            dactyl.clearMessage();
            dactyl.closeMessageWindow();

            cmd = cmdName + cmd.replace(/^(!?) ?/, "$1 ");
            if (forbidErrors)
                dactyl.assertNoErrorMessages(function () { dactyl.runExCommand(cmd) },
                                             null, [], cmd);
            else
                dactyl.runExCommand(cmd);
            controller.waitForPageLoad(controller.tabs.activeTab);

            test(cmd);
        });
    });
}
function _runCommands(cmdName, testName, commands) {
    addTest(cmdName, testName, function () {
        commands.forEach(function (cmd) {
            dactyl.runExCommand(cmd);
            controller.waitForPageLoad(controller.tabs.activeTab);
        });
    });
}

for (var val in Iterator(tests)) (function ([command, params]) {
    if (params.init)
        _runCommands(command, "init", params.init, function () {});

    // Goddamn stupid fucking MozMill and its stupid fucking sandboxes with their ancient fucking JS versions.
    for (var val in Iterator(params)) (function ([testName, commands]) {
        switch (testName) {
        case "noOutput":
            runCommands(command, testName, commands, function (cmd) {
                dactyl.assertMessage(function (msg) !msg, "Unexpected command output: " + cmd);
            });
            break;
        case "anyOutput":
            runCommands(command, testName, commands, function (cmd) {});
            break;
        case "someOutput":
            runCommands(command, testName, commands, function (cmd) {
                dactyl.assertMessage(/./, "Expected command output: " + cmd);
            });
            break;
        case "singleOutput":
            runCommands(command, testName, commands, function (cmd) {
                dactyl.assertMessageLine(/./, "Expected command output: " + cmd);
            }, true && !params.errorsOk);
            break;
        case "multiOutput":
            runCommands(command, testName, commands, function (cmd) {
                dactyl.assertMessageWindowOpen(true, "Expected command output: " + cmd);
            }, true && !params.errorsOk);
            break;
        case "error":
            addTest(command, testName, function () {
                commands.forEach(function (cmd) {
                    cmd = command + cmd.replace(/^(!?) ?/, "$1 ");
                    dactyl.assertMessageError(function () {
                        dactyl.runExCommand(cmd);
                        controller.waitForPageLoad(controller.tabs.activeTab);
                    }, null, [], cmd);
                });
            });
            break;
        case "completions":
            addTest(command, testName, function () {
                commands.forEach(function (cmd) {
                    dactyl.assertNoErrorMessages(function () {
                        dactyl.runExCompletion(command + cmd.replace(/^(!?) ?/, "$1 "));
                    });
                });
            });
            break;
        }
    })(val);

    if (params.cleanup)
        _runCommands(command, "cleanup", params.cleanup, function () {});
})(val);

// vim: sw=4 ts=8 et:
