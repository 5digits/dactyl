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
        let tab = TreeStyleTabService.getParentTab(tab);
        collapse = TreeStyleTabService.isSubtreeCollapsed(tab);
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

function create_command_and_mapping(command, description, funcref, mapping, command_option = {}) {
    group.commands.add([command], description, funcref, command_option, true );
    if (mapping != "")
        group.mappings.add([modes.NORMAL], [mapping], description, funcref);
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
        TreeStyleTabService.readyToOpenChildTab();
        dactyl.open(args, { where: dactyl.NEW_TAB });
    },
    ""
    );
