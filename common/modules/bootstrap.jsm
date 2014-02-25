// Copyright (c) 2011-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var EXPORTED_SYMBOLS = ["require"];

function create(proto) Object.create(proto);

this["import"] = function import_(obj) {
    let res = {};
    for (let key of Object.getOwnPropertyNames(obj))
        Object.defineProperty(res, key, Object.getOwnPropertyDescriptor(obj, key));
    return res;
}

// Deal with subScriptLoader prepending crap to loaded URLs
Components.utils.import("resource://gre/modules/Services.jsm");
function loadSubScript() Services.scriptloader.loadSubScript.apply(null, arguments);

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
