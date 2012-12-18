// Copyright (c) 2011-2012 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var EXPORTED_SYMBOLS = ["require"];

// Deal with cross-compartment XML passing issues.
function create(proto) Object.create(proto);
this["import"] = function import_(obj) {
    let res = {};
    for each (let key in Object.getOwnPropertyNames(obj))
        Object.defineProperty(res, key, Object.getOwnPropertyDescriptor(obj, key));
    return res;
}

// Deal with subScriptLoader prepending crap to loaded URLs
Components.utils.import("resource://gre/modules/Services.jsm");
function loadSubScript() Services.scriptloader.loadSubScript.apply(null, arguments);

