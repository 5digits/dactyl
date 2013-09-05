// Runs a slew of generic command tests

var utils = require("utils");
const { module } = utils;
var dactyllib = module("dactyl");
var jumlib = module("resource://mozmill/modules/jum.js");

var setupModule = function (module) {
    controller = mozmill.getBrowserController();
    dactyl = new dactyllib.Controller(controller);

    dactyl.modules.options["autocomplete"] = [];
    dactyl.modules.options["wildmode"] = ["list"];

    dactyl.modules.prefs.set("browser.tabs.closeWindowWithLastTab", false);
    dactyl.elements.multilineContainer.setAttribute("moz-collapsed", "true");
};
var teardownModule = function (module) {
    dactyl.elements.multilineContainer.removeAttribute("moz-collapsed");
    dactyl.teardown();
}

function $(selector) controller.window.document.querySelector(selector);

function hasNItems(nItems)
    function hasNItems(context) {
        utils.assertEqual("testCommand.hasNItems", nItems, context.allItems.items.length);
    };

function hasItems(context) context.allItems.items.length;

function hasntNullItems(context) hasItems(context) &&
    !context.allItems.items.some(function ({ text, description }) [text, description].some(function (text) /^\[object/.test(text)));

function sidebarState(state)
    function sidebarState() {
        utils.assertEqual("testCommand.sidebarState", state,
                          typeof state == "string" ? $("#sidebar-title").value
                                                   : !$("#sidebar-box").hidden);
    };
function toolbarState(selector, state)
    function toolbarState() {
        utils.assertEqual("testCommand.toolbarState", state, !$(selector).collapsed)
    };

var tests = {
    "!": {
        multiOutput: ["echo foo"]
    },
    get Clistkeys() this.listcommands,
    Cmap: {},
    Cnoremap: {},
    Cunmap: {},
    get Ilistkeys() this.listcommands,
    Imap: {},
    Inoremap: {},
    Iunmap: {},
    abbreviate: {
        error: ["!"],
        someOutput: ["", "abc"],
        noOutput: ["abc def", "-js abc def"],
        completions: ["", "abc ", "-js abc "]
    },
    addons: {
        error: ["!"],
        multiOutput: ["", "dactyl", "-type=extension", "-type=extension dactyl"],
        completions: [
            "",
            ["-types=", hasItems]
        ]
    },
    autocmd: {
        multiOutput: ["", "DOMLoad", "DOMLoad foo"],
        noOutput: ["DOMLoad foo bar", "-js DOMLoad foo bar"],
        completions: [
            ["", hasntNullItems],
            "DOMLoad foo ",
            "-js DOMLoad foo "
        ]
    },
    back: { noOutput: [""] },
    bdelete: {
        init: ["tabopen about:pentadactyl", "tabopen about:pentadactyl"],
        noOutput: [""],
        anyOutput: ["about:pentadactyl"],
        completions: [["", hasItems]]
    },
    get blistkeys() this.listcommands,
    bmap: {},
    bmark: {
        singleOutput: ["", "-tags=foo -title=bar -keyword=baz -charset=UTF-8 -post=quux about:pentadactyl"],
        error: ["-tags=foo -title=bar -keyword=baz -charset=nonExistentCharset -post=quux about:pentadactyl"],
        completions: [
            "-max=1 -keyword=",
            "-max=1 -keyword=foo -tags=",
            "-max=1 -keyword=foo -tags=bar -title=",
            ["-max=1 -keyword=foo -tags=bar -title=baz -charset=", hasItems],
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
    bnoremap: {},
    buffer: {
        anyOutput: ["", "1"],
        noOutput: ["!", "! 1"],
        completions: [
            ["", hasItems],
            ["1", hasItems]
        ]
    },
    buffers: {
        error: ["!"],
        multiOutput: ["", "1"],
        completions: ["", "1"]
    },
    bunmap: {},
    cd: {
        error: ["!"],
        singleOutput: ["", "~/"],
        completions: ["", "~/"]
    },
    get clistkeys() this.listcommands,
    cmap: {},
    cnoremap: {},
    colorscheme: {
        error: ["!", "", "some-nonexistent-scheme"]
    },
    command: {
        init: ["delc!"],
        singleOutput: ["", "foobar"],
        noOutput: ["foo bar", "-js bar baz"],
        multiOutput: [""],
        error: [
            "foo bar",
            "-js bar baz",
            "-group=builtin baz quux",
            "! -group=builtin baz quux",
        ],
        completions: [
            ["", hasItems],
            ["-group=", hasItems],
            ["-group=user ", hasItems]
        ]
    },
    completions: {
        error: ["!", ""]
    },
    contexts: { // Not testable in this manner
        error: ["!"]
    },
    cookies: {
        anyOutput: ["5digits.org", "5digits.org list"],
        error: ["!", ""],
        completions: [
            "",
            ["5digits.org ", hasItems]
        ]
    },
    cunabbreviate: {},
    cunmap: {},
    delbmarks: { anyOutput: ["", "about:pentadactyl"] },
    delcommand: [
        {
            init: ["delcommand!", "command foo bar"],
            error: [""],
            completions: [
                ["", hasItems],
                ["-group=", hasItems],
                ["-group=user ", hasItems]
            ],
            noOutput: ["foo", "! "]
        },
        {
            init: ["delcommand!"],
            error: ["foo"]
        }
    ],
    delgroup: {
        error: ["", "! foo", "builtin"],
        completions: [""]
    },
    delmacros: {
        error: ["", "! foo"],
        noOutput: ["x"],
        completions: ["", "x"]
    },
    get delmarks() this.delmacros,
    get delqmarks() this.delmacros,
    delstyle: {
        completions: ["", "-name=", "-name=foo ", "-index=", "-index="]
    },
    dialog: {
        error: ["!", ""],
        // Skip implementation for now
        completions: [
            ["", hasntNullItems]
        ]
    },
    dlclear: {
        error: ["!"]
    },
    doautoall: {
        error: ["!"]
    },
    doautocmd: {
        error: ["!"]
    },
    downloads: {
        error: ["!"],
        multiOutput: ["", "dactyl", "dactyl"]
    },
    echo: {
        error: ["!"],
        singleOutput: [
            ["' - '", " - "]
        ],
        multiOutput: [
            ["'\\n'", /\n/],
            ["window", /\[object\sChromeWindow\]/]
        ],
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
    else: {
        error: ["!", "foo"]
    },
    elseif: {
        error: ["!", ""]
    },
    emenu: {
        noOutput: ["View.Zoom.Zoom In", "View.Zoom.Zoom Out"],
        error: ["!", ""],
        completions: [
            ["", hasItems],
            ["View.", hasItems]
        ]
    },
    endif: {
        error: ["!", "foo"]
    },
    execute: {
        error: ["!"],
        noOutput: ["", "'js " + "".quote() + "'"],
        someOutput: ["'ls'"],
        completions: [["", hasItems]]
    },
    exit: {
        error: ["foo"]
    },
    extadd: {
        completions: [["", hasItems]],
        error: ["!", ""]
    },
    extdelete: {
        completions: [["", hasItems]],
        error: [""]
    },
    get extdisable() this.extdelete,
    extenable: {
        completions: [""],
        error: [""]
    },
    extoptions: {
        completions: [""],
        error: [""]
    },
    get extrehash() this.extdelete,
    get exttoggle() this.extdelete,
    get extupdate() this.extdelete,
    feedkeys: {
        noOutput: ["<Esc>"],
        error: [""]
    },
    finish: {
        error: ["!", "foo"],
        noOutput: [""]
    },
    forward: { noOutput: [""] },
    frameonly: {
        error: ["!", "foo"],
        noOutput: [""]
    },
    group: {
        multiOutput: [""],
        noOutput: [
            "foo -d='foo group' -nopersist -l 'bar.com','http://bar/*','http://bar','^http:'",
            "! foo -d='foo group' -nopersist -l 'bar.com','http://bar/*','http://bar','^http:'",
            "foo",
            "user"
        ],
        error: ["builtin"],
        completions: [
            "",
            "foo "
        ],
        cleanup: ["delmapgroup foo"]
    },
    hardcopy: {}, // Skip for now
    help: {
        error: ["!"],
        noOutput: ["", "intro"],
        cleanup: ["tabdelete", "tabdelete"],
        completions: [
            ["", hasItems],
            ["'wild", hasItems]
        ]
    },
    get helpall() this.help,
    highlight: {
        error: ["!"],
        multiOutput: ["", "Help"],
        noOutput: [
            "Help foo: bar;",
            "Help -group=FontCode",
            "Help -group=FontCode foo: bar;"
        ],
        completions: [
            ["", hasItems],
            ["Help", hasItems],
            ["Help ", hasItems],
            ["Help -group=", hasItems],
            ["Help -group=FontCode ", hasItems],
            ["Help foo: bar; -moz", hasItems]
        ]
    },
    history: {
        init: ["open about:pentadactyl"],
        anyOutput: ["-max=1", "-max=1 -sort=+date", "-max=1 dactyl"],
        completions: [
            ["", hasItems],
            "about:",
            ["-sort=+", hasItems],
            ["-sort=-", hasItems],
            ["-sort=+date ", hasItems],
            "-sort=+date about:"
        ]
    },
    if: {
        error: ["!", ""],
    },
    iabbreviate: {},
    get ilistkeys() this.listcommands,
    imap: {},
    inoremap: {},
    iunabbreviate: {},
    iunmap: {},
    javascript: {
        noOutput: ["''", "'\\n'", "<pre>foo bar</pre>", "window", "<<EOF\n''\nEOF"],
        completions: [
            ["", hasItems],
            ["window", hasItems],
            ["window.", hasItems],
            ["window['", hasItems],
            ["File('", hasItems],
            ["File.expandPath('", hasItems],
            "autocommands.user.get('",
            ["commands.get('", hasItems],
            ["commands.builtin.get('", hasItems],
            ["highlight.get('", hasItems],
            ["highlight.highlightNode(null, '", hasItems],
            ["mappings.get(modes.NORMAL, '", hasItems],
            // ["mappings.builtin.get(modes.NORMAL, '", hasItems],
            ["options.get('", hasItems],
            ["prefs.get('", hasItems],
            ["prefs.defaults.get('", hasItems],
            ["localPrefs.get('", hasItems],
            ["localPrefs.defaults.get('", hasItems],
            ["styles.system.get('", hasItems],
        ]
    },
    jumps: {
        error: ["!", "foo"],
        multiOutput: [""]
    },
    keepalt: {
        error: ["!", "", "some-nonexistent-command"],
        noOutput: ["js ''"],
        anyOutput: ["echo 'foo'"],
        completions: [["", hasItems]]
    },
    let: {
        error: ["!"]
    },
    listcommands: {
        error: ["!"],
        anyOutput: ["", "in"],
        completions: [
            ["", hasItems],
            "in "
        ]
    },
    get listkeys() this.listcommands,
    get listoptions() this.listcommands,
    loadplugins: {},
    macros: {
        error: ["!"],
        multiOutput: [""],
        completions: [""]
    },
    map: {
        error: ["!"],
        init: ["unmap!"],
        anyOutput: [""],
        singleOutput: ["i"],
        noOutput: [
            "i j",
            "-builtin i j",
            "-group=user -b i j",
            "-js i j()",
            "-ex i :j",
            "-silent i :j",
            "-mode=ex -b <C-a> <C-a>"
        ],
        multiOutput: ["", "i"],
        error: [
            "-mode=some-nonexistent-mode <C-a> <C-a>",
            "-group=some-nonexistent-group <C-a> <C-a>",
            "-group=builtin <C-a> <C-a>"
        ],
        completions: [
            ["", hasItems],
            ["-", hasItems],
            ["-mode=ex ", hasItems],
            ["-mode=", hasItems],
            ["-group=", hasItems],
            ["-builtin i ", hasItems],
            ["-ex i ", hasItems],
            ["-javascript i ", hasItems]
        ]
    },
    mark: {
        error: ["!", "", "#", "xy"],
        noOutput: ["y"],
        completions: [""]
    },
    marks: {
        init: ["delmarks q"],
        multiOutput: ["", "y"],
        error: ["!", "q", "#"],
        completions: [""]
    },
    messages: {
        error: ["!", "foo"],
        anyOutput: ["messages"]
    },
    messclear: {
        error: ["!", "foo"],
        noOutput: [""]
    },
    mkpentadactylrc: {
        noOutput: [
            "some-nonexistent-rc.penta",
            "! some-nonexistent-rc.penta"
        ],
        error: ["some-nonexistent-rc.penta"],
        completions: [""],
        cleanup: ["silent !rm some-nonexistent-rc.penta"]
    },
    mkvimruntime: {
        error: [
            "some-nonexistent-pentadactyl-dir/"
        ],
        completions: [
            ["", hasItems]
        ]
    },
    get mlistkeys() this.listcommands,
    mmap: {},
    mnoremap: {},
    munmap: {},
    get nlistkeys() this.listcommands,
    nmap: {},
    nnoremap: {},
    nohlfind: {
        error: ["!", "foo"]
    },
    noremap: {},
    normal: {
        error: [""],
        noOutput: ["<Nop>"],
        singleOutput: ["<C-g>"],
        multiOutput: ["g<C-g>"]
    },
    nunmap: {},
    open: {
        error: ["!"],
        noOutput: ["about:blank | about:home"],
        completions: [
            ["", hasItems],
            ["./", hasItems],
            ["./ | ", hasItems], // FIXME: broken feature
            ["chrome://", hasItems],
            ["chrome://browser/", hasItems],
            ["chrome://browser/content/", hasItems],
            ["about:", hasItems],
            ["resource://", hasItems],
            ["resource://dactyl/", hasItems]
        ]
    },
    pageinfo: {
        multiOutput: ["", "fgm"],
        completions: [["", hasItems]],
        error: ["!", "abcdefghijklmnopqrstuvwxyz", "f g m"]
    },
    pagestyle: {
        error: ["!"],
        completions: [""]
    },
    pintab: {},
    preferences: {
        error: ["foo"]
    },
    pwd: {
        error: ["!", "foo"],
        singleOutput: [""]
    },
    qmark: {
        singleOutput: [
            "m",
            "m foo bar"
        ],
        error: ["!", "", "#"],
        completions: [
            ["", hasItems],
            ["m ", hasItems]
        ]
    },
    qmarks: [
        {
            error: ["!"]
        },
        {
            init: ["delqmarks a-zA-Z0-9"],
            error: ["", "x"],
        },
        {
            init: ["qmark x"],
            multiOutput: ["", "m", "x"],
            completions: [["", hasItems]]
        }
    ],
    quit: {
        error: ["foo"]
    },
    quitall: {
        error: ["!", "foo"]
    },
    redraw: {
        error: ["!", "foo"],
        noOutput: [""]
    },
    rehash: {
        error: ["!"]
    },
    reload: {
        error: ["foo"],
        noOutput: [""]
    },
    reloadall: {
        error: ["foo"],
        noOutput: [""]
    },
    restart: {
        error: ["!", "foo"]
    },
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
        error: [
            "",
            "some-nonexistent/bad.js",
            "some-nonexistent/bad.penta"
        ],
        singleOutput: ["some-nonexistent-file.js"],
        completions: [
            ["", hasItems],
            ["some-nonexistent/", hasItems],
            ["info/", hasItems]
        ]
    },
    sanitize: {
        // Skip details for now.
        completions: [
            ["", function (context) ["all",
                                     "cache",
                                     "downloads",
                                     "formdata",
                                     "offlineapps",
                                     "passwords",
                                     "sessions",
                                     "cookies",
                                     "history",
                                     "host",
                                     "sitesettings",
                                     "commandline",
                                     "messages",
                                     "macros",
                                     "marks",
                                     "options"
                ].every(function (item) context.allItems.items.some(function ({ text }) item == text))
            ],
            "-",
            "-host=",
            "-timespan="
        ]
    },
    saveas: {},
    sbclose: {
        error: ["!", "foo"],
        noOutput: [""]
    },
    scriptnames: {
        error: ["!", "foo"]
    },
    set: {
        multiOutput: [
            "vb?", "cpt?", "messages?", "titlestring?", "au?", "eht?",
            "cpt", "messages", "titlestring", "au", "eht", "! "
        ],
        noOutput: ["vb", "novb"],
        completions: [
            ["", hasItems],
            ["c", hasItems],
            ["cpt=", hasItems],
            ["cpt=l", hasItems],
            ["cpt+=", hasItems],
            ["cpt+=f", hasItems],
            ["activate=", hasItems],
            ["activate=links,", hasItems],
            ["activate+=", hasItems],
            ["activate+=links,", hasItems],
            ["activate^=", hasItems],
            ["activate^=links,", hasItems],
            ["activate-=", hasItems],
            ["activate-=links,", hasItems],
            ["activate!=", hasItems],
            ["activate!=links,", hasItems]
        ]
    },
    get setglobal() this.set,
    get setlocal() this.set,
    sidebar: {
        error: ["!", ""],
        test: function (name) [
            ["! " + name, sidebarState(name)],
            [name, sidebarState(name)],
            ["! " + name, sidebarState(false)]
        ],
        get noOutput()
            Array.concat.apply([],
                ["Add-ons", // Final "! Add-ons" currently failing
                 "Bookmarks",
                 "Downloads",
                 "Console",
                 "History",
                 "Preferences"]
            .map(this.test))
            .concat([
                ["Preferences", sidebarState("Preferences")],
                ["!", sidebarState(false)]
            ]),
        completions: [
            ["", hasntNullItems],
            "! "
        ]
    },
    silent: {
        error: ["!"],
        noOutput: [
            "echo 'foo'",
            "echo " + "foo\nbar".quote(),
            "echoerr 'foo'",
            "echoerr " + "foo\nbar".quote()
        ],
        completions: [["", hasItems]]
    },
    get source() ({
        init: this.runtime.init,
        cleanup: this.runtime.cleanup,
        noOutput: [
            "! .pentadactyl/some-nonexistent/really-nonexistent.js",
            ".pentadactyl/some-nonexistent/good.css",
            ".pentadactyl/some-nonexistent/good.js",
            ".pentadactyl/some-nonexistent/good.penta"
        ],
        error: [
            "",
            ".pentadactyl/some-nonexistent/really-nonexistent.js",
            "~/.pentadactyl/some-nonexistent/bad.js",
            "~/.pentadactyl/some-nonexistent/bad.penta",
            "./.pentadactyl/some-nonexistent/bad.js",
            "./.pentadactyl/some-nonexistent/bad.penta",
            ".pentadactyl/some-nonexistent/bad.js",
            ".pentadactyl/some-nonexistent/bad.penta",
            ".pentadactyl/some-nonexistent-file.js"
        ],
        completions: [
            ["", hasItems],
            [".pentadactyl/some-nonexistent/", hasItems],
            ["chrome://browser/content/", hasItems],
            ["resource://dactyl/", hasItems]
        ]
    }),
    stop: {
        error: ["!", "foo"],
        noOutput: [""]
    },
    stopall: {
        error: ["!", "foo"],
        noOutput: [""]
    },
    style: {
        error: ["!"],
        cleanup: ["delstyle -n foo"],
        noOutput: [
            "-name=foo http://does.not.exist/* div { display: inline; }",
            "-name=foo -append http://does.not.exist/* span { display: block; }"
        ],
        multiOutput: [
            "",
            "-name=foo"
        ],
        completions: [
            ["", hasItems],
            ["-name=", hasItems],
            ["http:* div { -moz", hasItems],
            ["http:* div { foo: bar; -moz", hasItems],
            ["http:* div { foo: bar; } span { -moz", hasItems],
            ["http:* div { foo: bar; } span { foo: bar; -moz", hasItems]
        ]
    },
    styledisable: {
        init: ["style -n foo http:* div {}", "style -n bar ftp:* div", "styledisable -n bar"],
        cleanup: ["delstyle -n foo", "delstyle -n bar"],
        completions: [
            ["", hasItems],
            ["-name=", hasNItems(1)],
            ["-index=", hasNItems(1)]
        ],
        noOutput: ["-name=foo", "-name=bar"]
    },
    get styleenable() this.styledisable,
    styletoggle: {
        init: ["style -n foo http:* div {}", "style -n bar ftp:* div", "styledisable -n bar"],
        cleanup: ["delstyle -n foo", "delstyle -n bar"],
        noOutput: ["-name=foo"],
        completions: [
            ["", hasItems],
            ["-name=", hasNItems(2)],
            ["-index=", hasNItems(2)]
        ]
    },
    tab: {
        error: ["!", "", "some-nonexistent-command"],
        noOutput: ["js ''"],
        anyOutput: ["echo 'foo'"],
        completions: [["", hasItems]]
    },
    tabattach: {
        error: ["!", ""]
    },
    tabdetach: {
        error: ["!", "foo"]
    },
    tabdo: {
        error: ["!", "", "some-nonexistent-command"],
        noOutput: ["js ''"],
        anyOutput: ["echo 'foo'"],
        completions: [["", hasItems]]
    },
    tabduplicate: {
        error: ["foo"]
    },
    tablast: {
        error: ["!", "foo"]
    },
    tabmove: {
        error: [""],
        noOutput: ["1", "$", "999", "-1", "+1", "! +1", "! -1", "-999", "+999", "! +999", "! -999"],
        completions: [
            ["", hasItems],
            ["1", hasItems]
        ]
    },
    tabnext: {
        error: ["!", "foo"]
    },
    tabonly: {
        error: ["!", "foo"]
    },
    tabopen: {},
    tabprevious: {
        error: ["!", "foo"]
    },
    tabrewind: {
        error: ["!", "foo"]
    },
    time: {
        error: ["", ":some-nonexistent-command"/*, "some_nonexistent_reference"*/], // FIXME
        singleOutput: [":js null", "null"]
    },
    get tlistkeys() this.listcommands,
    tmap: {},
    tnoremap: {},
    toolbarhide: {
        init: [
            ["tbs Navigation Toolbar", toolbarState("#nav-bar", true)],
            ["tbs Bookmarks Toolbar", toolbarState("#PersonalToolbar", true)]
        ],
        completions: [["", hasItems]],
        noOutput: [
            ["Navigation Toolbar", toolbarState("#nav-bar", false)],
            ["Bookmarks Toolbar", toolbarState("#PersonalToolbar", false)]
        ],
        error: ["!", "", "foo"]
    },
    toolbarshow: {
        completions: [["", hasItems]],
        noOutput: [
            ["Navigation Toolbar", toolbarState("#nav-bar", true)],
            ["Bookmarks Toolbar", toolbarState("#PersonalToolbar", true)]
        ],
        error: ["!", "", "foo"]
    },
    toolbartoggle: {
        completions: [["", hasItems]],
        noOutput: [
            ["Navigation Toolbar", toolbarState("#nav-bar", false)],
            ["Bookmarks Toolbar", toolbarState("#PersonalToolbar", false)],
            ["Navigation Toolbar", toolbarState("#nav-bar", true)],
            ["Bookmarks Toolbar", toolbarState("#PersonalToolbar", true)],
            ["Navigation Toolbar", toolbarState("#nav-bar", false)],
            ["Bookmarks Toolbar", toolbarState("#PersonalToolbar", false)]
        ],
        error: ["!", "", "foo"]
    },
    tunmap: {},
    unabbreviate: {
        noOutput: ["abc", "! "],
        error: [""]
    },
    undo: {
        error: ["!"]
    },
    undoall: {
        error: ["!", "foo"]
    },
    unpintab: {
        error: ["!"]
    },
    unlet: {
        error: [""],
    },
    unmap: {
        noOutput: [
            "i",
            "! "
        ],
        error: [
            "i",
            "-group=builtin k",
            "! -group=builtin"
        ],
        completions: [
            "",
            "-group="
        ]
    },
    verbose: {
        error: ["!", ""]
    },
    version: {
        error: ["foo"],
        multiOutput: [
            ["", function (msg) {
                var res = /(\w+dactyl) (\S+) \(([\^)]+)\) running on:\nMozilla/.exec(msg);
                return res && res[2] != "null" && res[3] != "null";
            }]
        ]
    },
    viewsource: {},
    get vlistkeys() this.listcommands,
    vmap: {},
    vnoremap: {},
    vunmap: {},
    winclose: {
        error: ["!", "foo"]
    },
    window: {
        error: ["!", ""]
    },
    winonly: {
        error: ["!", "foo"]
    },
    winopen: {
        error: ["!"]
    },
    wqall: {
        error: ["!", "foo"]
    },
    yank: {
        multiOutput: [
            ["foo".quote(), /foo/],
            [":echo " + "bar".quote(), /bar/],
            [":addons", /Pentadactyl/]
        ],
        error: [
            "!", "",
            ":echoerr " + "foo".quote()
        ],
        completions: [
            ["", hasItems],
            [":", hasItems]
        ]
    },
    zoom: {}
};

var global = this;
function addTest(cmdName, testName, func) {
    global["testCommand_" + cmdName + "_" + testName] = func;
}

function runCommands(cmdName, testName, commands, test, forbidErrors) {
    addTest(cmdName, testName, function () {
        commands.forEach(function (val) {
            var [cmd, testVal] = Array.concat(val);

            dump("CMD: " + testName + " " + cmdName + " " + cmd + "\n");
            dactyl.clearMessage();
            dactyl.closeMessageWindow();

            cmd = cmdName + cmd.replace(/^(!?) ?/, "$1 ");
            if (forbidErrors)
                dactyl.assertNoErrorMessages(function () { dactyl.runExCommand(cmd) },
                                             null, [], cmd);
            else
                dactyl.runExCommand(cmd);
            controller.waitForPageLoad(controller.tabs.activeTab);

            test(cmd, testVal);
        });
    });
}
function _runCommands(cmdName, testName, commands) {
    addTest(cmdName, testName, function () {
        commands.forEach(function (value) {
            var [cmd, test] = Array.concat(value);

            dump("CMD: " + testName + " " + cmdName + " " + cmd + "\n");
            var res = dactyl.runExCommand(cmd);
            controller.waitForPageLoad(controller.tabs.activeTab);
            runTest("Initializing for " + cmdName + " tests failed: " + cmd.quote() + " " + test,
                    test);
        });
    });
}

function runTest(message, test, ...args) {
    if (test)
        var res = test.apply(null, args);
    if (res !== undefined)
        jumlib.assert(res, message);
}

for (var val in Iterator(tests)) (function ([command, paramsList]) {
    Array.concat(paramsList).forEach(function (params, i) {
        if (params.init)
            _runCommands(command, "init" + (i || ""), params.init);

        // Goddamn stupid fucking MozMill and its stupid fucking sandboxes with their ancient fucking JS versions.
        for (var val in Iterator(params)) (function ([test, commands]) {
            var testName = test + (i || "");

            switch (test) {
            case "noOutput":
                runCommands(command, testName, commands, function (cmd, test) {
                    var res = dactyl.assertMessage(function (msg) !msg, "Unexpected command output: " + cmd);
                    if (res && test)
                        dactyl.assertMessage(test, "Running " + testName + " tests failed: " + cmd.quote() + " " + test.toSource());
                });
                break;
            case "anyOutput":
                runCommands(command, testName, commands, function (cmd, test) {
                    if (test)
                        dactyl.assertMessage(test, "Running " + testName + " tests failed: " + cmd.quote() + " " + test.toSource());
                });
                break;
            case "someOutput":
                runCommands(command, testName, commands, function (cmd, test) {
                    var res = dactyl.assertMessage(/./, "Expected command output: " + cmd);
                    if (res && test != null)
                        dactyl.assertMessage(test, "Running " + testName + " tests failed: " + cmd.quote() + " " + test.toSource());
                });
                break;
            case "singleOutput":
                runCommands(command, testName, commands, function (cmd, test) {
                    var res = dactyl.assertMessageLine(/./, "Expected command output: " + cmd);
                    if (res && test != null)
                        dactyl.assertMessageLine(test, "Running " + testName + " tests failed: " + cmd.quote() + " " + test.toSource());
                }, !params.errorsOk);
                break;
            case "multiOutput":
                runCommands(command, testName, commands, function (cmd, test) {
                    var res = dactyl.assertMessageWindowOpen(true, "Expected command output: " + cmd);
                    if (res && test != null)
                        dactyl.assertMessageWindow(test, "Running " + testName + " tests failed: " + cmd.quote() + " " + test.toSource());
                }, !params.errorsOk);
                break;
            case "error":
                addTest(command, testName, function () {
                    commands.forEach(function (val) {
                        var [cmd, test] = Array.concat(val);
                        cmd = command + cmd.replace(/^(!?) ?/, "$1 ");

                        var res = dactyl.assertMessageError(function () {
                            dactyl.runExCommand(cmd);
                            controller.waitForPageLoad(controller.tabs.activeTab);
                        }, null, [], cmd);

                        if (res && test != null)
                            dactyl.assertMessage(test, "Running " + testName + " tests failed: " + cmd.quote() + " " + test.toSource());
                    });
                });
                break;
            case "completions":
                addTest(command, testName, function () {
                    commands.forEach(function (val) {
                        var [cmd, test] = Array.concat(val);
                        cmd = command + cmd.replace(/^(!?) ?/, "$1 ");

                        dactyl.assertNoErrorMessages(function () {
                            dump("COMPL: " + cmd + "\n");
                            var context = dactyl.runExCompletion(cmd);
                            if (context)
                                runTest("Completion tests failed: " + cmd.quote() + " " + test,
                                        test, context);
                        });
                    });
                });
                break;
            }
        })(val);

        if (params.cleanup)
            _runCommands(command, "cleanup" + (i || ""), params.cleanup);
    });
})(val);

// vim: sw=4 ts=8 et:
