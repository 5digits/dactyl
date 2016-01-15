"use strict";
var INFO = [
        "plugin",
        {
            name: "treestyletabs",
            version: "0.1",
            href: "",
            summary: "TreeStyleTabs integration for Pentadactyl",
            xmlns: "dactyl"
        },
        [
            "author",
            { email: "nelo@wallus.de" },
            "Nelo-T. Wallus"
        ],
        [
            "license",
            { href: "http://opensource.org/licenses/mit-license.php" },
            "MIT"
        ],
        [
            "project",
            { name: "Pentadactyl", "min-version": "1.0" }
        ],
        [
            "p", {},
            "A set of commands to be able to properly use TreeStyleTabs with pentadactyl. ",
            "Please note that the functions tend to be slow when mapped to keys (this is a ",
            "general problem), so if it's too slow for you copy this script and insert the ",
            "binds you want in the empty quotes in every create_command_and_mapping(). "
        ]
    ];

// pass true to close, false to open
function fold_collapse_expand_target(tab, collapse, children = false) {
    if (children) {
        let children = TreeStyleTabService.getDescendantTabs(tab);
        for (let x in children) {
            gBrowser.treeStyleTab.collapseExpandSubtree(children[x], collapse);
        }
    }
    gBrowser.treeStyleTab.collapseExpandSubtree(tab, collapse);
}

function fold_collapse_expand(collapse, children = false) {
    let tab = gBrowser.tabContainer.selectedItem;

    if (!TreeStyleTabService.hasChildTabs(tab)) {
        tab = TreeStyleTabService.getParentTab(tab);
        gBrowser.tabContainer.selectedIndex = gBrowser.tabContainer.getIndexOfItem(tab);
    }

    fold_collapse_expand_target(
        tab,
        collapse,
        children
        );
}

function fold_collapse_expand_toggle(children = false) {
    fold_collapse_expand(
        !TreeStyleTabService.isSubtreeCollapsed(gBrowser.tabContainer.selectedItem),
        children
        );
}

function info_add_description(tags, description) {
    INFO = INFO.concat(
            [
                "item", {},
                ["tags", {}, tags],
                ["spec", {}, tags],
                ["description", {}, ["p", {}, description ]]
            ]
        );
}

function create_command_and_mapping(command, description, funcref, mapping, command_option = {}) {
    group.commands.add([command], description, funcref, command_option, true );
    if (mapping != "")
        group.mappings.add([modes.NORMAL], [mapping], description, funcref);
    info_add_description(":" + command + " " + mapping, description);
}

create_command_and_mapping(
    "foldopen",
    "Open fold under tab",
    function () {
        fold_collapse_expand(false);
    },
    "zo"
    );

create_command_and_mapping(
    "foldopenrecursively",
    "Open fold under tab recursively",
    function () {
        fold_collapse_expand(false, true);
    },
    "zO"
    );

create_command_and_mapping(
    "foldclose",
    "Close fold under tab",
    function () {
        fold_collapse_expand(true);
    },
    "zc"
    );

create_command_and_mapping(
    "foldcloserecursively",
    "Close fold under tab recursively",
    function () {
        fold_collapse_expand(true, true);
    },
    "zC"
    );

create_command_and_mapping(
    "foldtoggle",
    "Toggle fold under tab",
    function () {
        fold_collapse_expand_toggle();
    },
    "za"
    );

create_command_and_mapping(
    "foldtogglerecursively",
    "Toggle fold under tab recursively",
    function () {
        fold_collapse_expand_toggle(true);
    },
    "zA"
    );

create_command_and_mapping(
    "foldcloseall",
    "Close all folds",
    function () {
        let roots = TreeStyleTabService.rootTabs;
        for (let x in roots) {
            fold_collapse_expand_target(roots[x], true, true);
        }
    },
    "zM"
    );

create_command_and_mapping(
    "foldopenall",
    "Open all folds",
    function () {
        let roots = TreeStyleTabService.rootTabs;
        for (let x in roots) {
            fold_collapse_expand_target(roots[x], false, true);
        }
    },
    "zR"
    );

create_command_and_mapping(
    "tabpromote",
    "Promote current tab",
    function () {
        TreeStyleTabService.promoteCurrentTab();
    },
    "<"
    );

create_command_and_mapping(
    "tabdemote",
    "Demote current tab",
    function () {
        TreeStyleTabService.demoteCurrentTab();
    },
    ">"
    );

create_command_and_mapping(
    "tabchildopen",
    "Open one or more URLs in a new child tab",
    function (args) {
        let tab = gBrowser.tabContainer.selectedItem;
        TreeStyleTabService.readyToOpenChildTab(tab, true);
        dactyl.open(args[0] || "about:blank",
            { from: "tabopen", where: dactyl.NEW_TAB, background: args.bang });
        TreeStyleTabService.stopToOpenChildTab();
    },
    "",
    {
        bang: true,
        completer: function (context) {
            completion.url(context);
        },
        domains: function (args) {
            return commands.get("open").domains(args);
        },
        literal: 0,
        privateData: true
    }
    );

create_command_and_mapping(
    "tabbartoggle",
    "Toggle tab bar",
    function () {
        gBrowser.treeStyleTab.tabbarShown=!gBrowser.treeStyleTab.tabbarShown;
    },
    ""
    );

create_command_and_mapping(
    "tabclosechildren",
    "Close children of current tab",
    function () {
        let tab = gBrowser.tabContainer.selectedItem;
        let children = TreeStyleTabService.getDescendantTabs(tab);
        for (let child in children) {
            config.removeTab(children[child]);
        }
    },
    ""
    )

create_command_and_mapping(
    "tabclosewithchildren",
    "Close children and current tab",
    function () {
        let tab = gBrowser.tabContainer.selectedItem;
        let children = TreeStyleTabService.getDescendantTabs(tab);
        for (let child in children) {
            config.removeTab(children[child]);
        }
        config.removeTab(tab);
    },
    ""
    )

create_command_and_mapping(
    "tabnextvisible",
    "Switch to the next visible tab",
    function () {
        let tab = TreeStyleTabService.getNextVisibleTab(gBrowser.tabContainer.selectedItem);
        gBrowser.tabContainer.selectedIndex = gBrowser.tabContainer.getIndexOfItem(tab);
    },
    ""
    )

create_command_and_mapping(
    "tabpreviousvisible",
    "Switch to the previous visible tab",
    function () {
        let tab = TreeStyleTabService.getPreviousVisibleTab(gBrowser.tabContainer.selectedItem);
        gBrowser.tabContainer.selectedIndex = gBrowser.tabContainer.getIndexOfItem(tab);
    },
    ""
    )

create_command_and_mapping(
    "tabattachto",
    "Attach tab as child to another tab",
    function (args) {
        if (args[0]) {
            let tab = gBrowser.tabContainer.selectedItem;

            let parenttab = tabs.getTab(parseInt(args[0], 10) - 1);

            gBrowser.treeStyleTab.attachTabTo(tab, parenttab);
        }
    },
    "",
    {
        completer: function (context) {
            completion.buffer(context, false);
        }
    }
    )

create_command_and_mapping(
    "tabdetachfrom",
    "Detach tab from parent",
    function () {
        gBrowser.treeStyleTab.detachTab(gBrowser.tabContainer.selectedItem);
    },
    ""
    )
