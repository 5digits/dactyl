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
        anyOutput: ["bmark", "bmark -tags=foo -titlt=bar -keyword=baz -charset=UTF-8 -post=quux about:pentadactyl"],
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
        anyOutput: ["", "~/"],
        completions: ["", "~/"]
    },
    colorscheme: {
        error: ["", "some-non-existent-scheme"]
    },
    command: {
        anyOutput: ["", "foo", "foo bar", "-js bar baz"],
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
        completions: [
            "", "-name=", "-name=foo ", "-index=", "-index="
        ]
    },
    dialog: {
        // Skip implementation for now
        completions: ["", "pre"]
    },
    doautoall: {}, // Skip for now
    doautocmd: {}, // Skip for now
    downloads: {
        multiOutput: ["", "dactyl", "-type=extension", "-type=extension dactyl"]
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
    get echoerr() this.echo,
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
        multiOutput: [""]
    },
    map: {
        multiOutput: ["", "i"],
        noOutput: ["i j", "-b i j", "-js i j()", "-ex i :j"]
    },
    mapclear: {
        noOutput: [""]
    },
    mapgroup: {},
    mark: {},
    marks: {},
    messages: {},
    messclear: {},
    mkpentadactylrc: {},
    mksyntax: {},
    mlistkeys: {},
    mmap: {},
    mmapclear: {},
    mnoremap: {},
    munmap: {},
    nlistkeys: {},
    nmap: {},
    nmapclear: {},
    nnoremap: {},
    nohlfind: {},
    noremap: {},
    normal: {},
    nunmap: {},
    open: {},
    pageinfo: {},
    pagestyle: {},
    preferences: {},
    pwd: {},
    qmark: {},
    qmarks: {},
    quit: {},
    quitall: {},
    redraw: {},
    rehash: {},
    reload: {},
    reloadall: {},
    restart: {},
    runtime: {},
    sanitize: {},
    saveas: {},
    sbclose: {},
    scriptnames: {},
    set: {},
    setglobal: {},
    setlocal: {},
    sidebar: {},
    silent: {},
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
    tlistkeys: {},
    tmap: {},
    tmapclear: {},
    tnoremap: {},
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
    vlistkeys: {},
    vmap: {},
    vmapclear: {},
    vnoremap: {},
    vunmap: {},
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

function runCommands(cmdName, testName, commands, test) {
    addTest(cmdName, testName, function () {
        commands.forEach(function (cmd) {
            // dump("CMD: " + cmdName + " " + cmd + "\n");
            dactyl.clearMessage();
            dactyl.closeMessageWindow();
            cmd = cmdName + cmd.replace(/^(!?) ?/, "$1 ");
            dactyl.runExCommand(cmd);
            test(cmd);
        });
    });
}

for (var val in Iterator(tests)) (function ([command, params]) {
    if (params.init)
        runCommands(command, "init", params.init, function () {});

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
            });
            break;
        case "multiOutput":
            runCommands(command, testName, commands, function (cmd) {
                dactyl.assertMessageWindowOpen(true, "Expected command output: " + cmd);
            });
            break;
        case "error":
            addTest(command, testName, function () {
                commands.forEach(function (cmd) {
                    cmd = command + cmd.replace(/^(!?) ?/, "$1 ");
                    dactyl.assertMessageError(function () {
                        dactyl.runExCommand(cmd);
                    }, null, [], cmd);
                });
            });
            break;
        case "completions":
            addTest(command, testName, function () {
                commands.forEach(function (cmd) {
                    dactyl.runExCompletion(command + cmd.replace(/^(!?) ?/, "$1 "));
                });
            });
            break;
        }
    })(val);

    if (params.cleanup)
        runCommands(command, "cleanup", params.cleanup, function () {});
})(val);

// vim: sw=4 ts=8 et:
