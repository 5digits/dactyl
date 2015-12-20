"use strict";
var INFO =
["plugin", { name: "xpcom",
              version: "0.4",
              href: "http://dactyl.sf.net/pentadactyl/plugins#xpcom-plugin",
              summary: "XPCOM development",
              xmlns: "dactyl" },
    ["author", { email: "maglione.k@gmail.com" },
        "Kris Maglione"],
    ["license", { href: "http://opensource.org/licenses/mit-license.php" },
        "MIT"],
    ["project", { name: "Pentadactyl", "min-version": "1.0" }],

    ["p", {},
        "This plugin aids in the development of XPCOM-related code, and ",
        "in the exploration of extant XPCOM interfaces, classes, and ",
        "instances. All of the functions herein are exported to the ",
        "<em>userContext</em> and are thus available from the ",
        "<ex>:javascript</ex> command. Each of these functions provides ",
        "JavaScript completion for its arguments."],

    ["item", {},
        ["tags", {}, "xpwrapper"],
        ["spec", {}, "xpwrapper(<a>instance</a>, <oa>interface</oa>)"],
        ["spec", {}, "xpwrapper(<a>string</a>)"],
        ["description", {},
            ["p", {},
                "This function is the core of the plugin. It wraps XPCOM ",
                "objects so that their properties are more easily ",
                "accessible. When ", ["a", {}, "instance"], " alone is given, the ",
                "result contains one property for each interface that ",
                ["a", {}, "instance"], " implements. Each of those properties, in ",
                "turn, returns ", ["a", {}, "instance"], " wrapped in a call to ",

                ["code", {}, "xpwrapper(", ["a", {}, "instance"], ", ", ["a", {}, "interface"], "),"],

                "which contains only the properties of ", ["a", {}, "instance"], " ",
                "specified in ", ["a", {}, "interface"], ". Additionally, the ",
                "one-argument form contains the properties ", ["em", {}, "all"], "" ,
                "and ", ["em", {}, "wrappedJSObject"], ", the former of which ",
                "returns an object that implements all interfaces ",
                "provided by the instance, and the latter of which, when ",
                "applicable, is the raw JavaScript object that backs the ",
                "XPCOM instance."],

            ["p", {},
                "When ", ["a", {}, "string"], " is provided rather than an XPCOM ",
                "instance, the returned object contains all of the ",
                "properties specified by the interface with the given ",
                "name, each with an ", ["hl", { key: "Object" }, "undefined"], " value."]]],

    ["item", {},
        ["tags", {}, "xpclasses"],
        ["spec", {}, "xpclasses(", ["a", {}, "class"], ")"],
        ["spec", {}, "xpclasses(", ["a", {}, "string"], ")"],
        ["description", {},
            ["p", {},
                "When given an XPCOM instance as its first argument, ",
                "the result is exactly the same as the one argument form ",
                "of ", ["em", {}, "xpwrapper"], ". When given a string, returns the ",
                "", ["em", {}, "xpwrapper"], " for an instance of the provided ",
                "XPCOM contract ID."]]],

    ["item", {},
        ["tags", {}, "xpproviders"],
        ["strut"],
        ["spec", {}, "xpproviders"],
        ["description", {},
            ["p", {},
                "Presents, for each installed interface, a property for ",
                "each class that provides that interface. The properties ",
                "on both levels are lazily instantiated, so iterating ",
                "over the values of either level is not a good idea."],

            ["example", {},
                ["ex", {}, ':js xpproviders.nsILocalFile["',
                    ["k", { name: "Tab", link: "c_<Tab>" }]]]]],

    ["item", {},
        ["tags", {}, "xpservices"],
        ["spec", {}, "xpservices(", ["a", {}, "class"], ")"],
        ["spec", {}, "xpservices[", ["a", {}, "class"], "]"],
        ["description", {},
            ["p", {},
                "An object containing an ", ["t", {}, "xpwrapper"], " wrapped service for ",
                "each contract ID in ", ["em", {}, "Components.classes"], "."]]]];

function Completer(obj) {
    return [(context) => {
        context.anchored = false;
        return Object.keys(obj).map(k => [k, k]);
    }];
}

userContext.xpwrapper = function xpwrapper(obj, iface) {
    let res = {};
    if (arguments.length == 2) {
        try {
            let shim = XPCOMShim([iface]);
            iter.forEach(properties(shim), function (prop) {
                res.__defineGetter__(prop, function () {
                    let res = obj.QueryInterface(Ci[iface])[prop];
                    if (callable(res)) {
                        let fn = (...args) => res.apply(obj, args);
                        fn.toString = () => res.toString();
                        fn.toSource = () => res.toSource();
                        return fn;
                    }
                    return res;
                })
            });
        }
        catch (e if e === Cr.NS_ERROR_NO_INTERFACE) {
            res = null
        }
    }
    else if (isString(obj))
        return xpwrapper({}, obj);
    else {
        for (let iface in Ci)
            if (Ci[iface] instanceof Ci.nsIJSIID)
                try {
                    obj.QueryInterface(Ci[iface]);
                    memoize(res, iface, iface => xpwrapper(obj, iface));
                }
                catch (e) {};

        memoize(res, "all", function (iface) {
            try {
                for (let iface of Object.keys(Ci))
                    obj instanceof Ci[iface];
            }
            catch (e) {}
            return obj;
        });
        if ("wrappedJSObject" in obj)
            memoize(res, "wrappedJSObject", () => obj.wrappedJSObject);
    }
    return res;
}

memoize(userContext, "xpclasses", function () {
    function xpclasses(cls) {
        if (typeof cls == "string")
            cls = Cc[cls].createInstance();
        return userContext.xpwrapper(cls);
    }
    Object.keys(Cc).forEach(function (k) {
        xpclasses.__defineGetter__(k, () => xpclasses(k));
    });
    JavaScript.setCompleter([xpclasses], Completer(Cc));
    return xpclasses;
});

memoize(userContext, "xpinterfaces", function () {
    function xpinterfaces(inst) {
        if (typeof inst == "string")
            inst = Cc[inst].createInstance();
        inst = inst.QueryInterface(Ci.nsIInterfaceRequestor);

        let res = {};
        for (let iface in Ci)
            if (Ci[iface] instanceof Ci.nsIJSIID)
                try {
                    inst.getInterface(Ci[iface]);
                    memoize(res, iface, iface => userContext.xpwrapper(inst.getInterface(Ci[iface])));
                }
                catch (e) {}

        return res;
    }
    return xpinterfaces;
});

memoize(userContext, "xpservices", function () {
    function xpservices(cls) {
        if (typeof cls == "string")
            cls = Cc[cls].getService();
        return userContext.xpwrapper(cls);
    }
    Object.keys(Cc).forEach(function (k) {
        xpservices.__defineGetter__(k, () => xpservices(k));
    });
    JavaScript.setCompleter([xpservices], Completer(Cc));
    return xpservices;
});

JavaScript.setCompleter([userContext.xpwrapper], Completer(Ci));

memoize(userContext, "xpproviders", function () {
    function xpproviders(iface) {
        iface = Ci[iface];
        let res = {};
        for (let cls in Cc)
            try {
                if (Cc[cls].getService() instanceof iface)
                    memoize(res, cls, cls =>
                        userContext.xpwrapper(Cc[cls].getService(), iface));
            }
            catch (e) {}
        return res;
    }
    for (let iface in Ci)
        memoize(xpproviders, iface, xpproviders);
    JavaScript.setCompleter([xpproviders], Completer(Ci));
    return xpproviders;
});

/* vim:se sts=4 sw=4 et: */
