// Copyright (c) 2008-2010 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

Components.utils.import("resource://dactyl/base.jsm");
defineModule("javascript", {
    exports: ["JavaScript", "javascript"],
    use: ["services", "template", "util"],
});

// TODO: Clean this up.

var JavaScript = Module("javascript", {
    Local: function (dactyl, modules, window) ({
        init: function () {
            this.modules = modules;
            this.window = window

            this._stack = [];
            this._functions = [];
            this._top = {};  // The element on the top of the stack.
            this._last = ""; // The last opening char pushed onto the stack.
            this._lastNonwhite = ""; // Last non-whitespace character we saw.
            this._lastChar = "";     // Last character we saw, used for \ escaping quotes.
            this._str = "";

            this._lastIdx = 0;

            this._cacheKey = null;

            this._nullSandbox = Cu.Sandbox("about:blank");
        },
    }),

    newContext: function () this.modules.newContext(this.modules.userContext),

    get completers() JavaScript.completers, // For backward compatibility

    // Some object members are only accessible as function calls
    getKey: function (obj, key) {
        try {
            return obj[key];
        }
        catch (e) {}
        return undefined;
    },

    iter: function iter_(obj, toplevel) {
        if (obj == null)
            return;

        let seen = isinstance(obj, ["Sandbox"]) ? set(JavaScript.magicalNames) : {};
        let globals = values(toplevel && this.window === obj ? this.globalNames : []);
        if (toplevel && "wrappedJSObject" in obj)
            yield "wrappedJSObject";
        for (let key in iter(globals, properties(obj, !toplevel, true)))
            if (!set.add(seen, key))
                yield key;

        // Properties aren't visible in an XPCNativeWrapper until
        // they're accessed.
        for (let key in properties(this.getKey(obj, "wrappedJSObject"), !toplevel, true))
            try {
                if (key in obj && !set.has(seen, key))
                    yield key;
            }
            catch (e) {}
    },

    objectKeys: function objectKeys(obj, toplevel) {
        // Things we can dereference
        if (!obj || ["object", "string", "function"].indexOf(typeof obj) === -1)
            return [];
        if (isinstance(obj, ["Sandbox"]) && !toplevel) // Temporary hack.
            return [];
        if (this.modules.jsmodules.isPrototypeOf(obj) && !toplevel)
            return [];

        let completions = [k for (k in this.iter(obj, toplevel))];
        if (obj === this.modules) // Hack.
            completions = completions.concat([k for (k in this.iter(this.modules.jsmodules, toplevel))]);
        return completions;
    },

    evalled: function evalled(arg, key, tmp) {
        let cache = this.context.cache.evalled;
        let context = this.context.cache.evalContext;

        if (!key)
            key = arg;
        if (key in cache)
            return cache[key];

        context[JavaScript.EVAL_TMP] = tmp;
        context[JavaScript.EVAL_EXPORT] = function export(obj) cache[key] = obj;
        try {
            if (tmp != null) // Temporary hack until bug 609949 is fixed.
                this.modules.dactyl.userEval(JavaScript.EVAL_EXPORT + "(" + arg + ")", context, "[Command Line Completion]", 1);
            else
                cache[key] = this.modules.dactyl.userEval(arg, context, "[Command Line Completion]", 1);

            return cache[key];
        }
        catch (e) {
            this.context.message = "Error: " + e;
            return null;
        }
        finally {
            delete context[JavaScript.EVAL_TMP];
        }
    },

    // Get an element from the stack. If @frame is negative,
    // count from the top of the stack, otherwise, the bottom.
    // If @nth is provided, return the @mth value of element @type
    // of the stack entry at @frame.
    _get: function (frame, nth, type) {
        let a = this._stack[frame >= 0 ? frame : this._stack.length + frame];
        if (type != null)
            a = a[type];
        if (nth == null)
            return a;
        return a[a.length - nth - 1];
    },

    // Push and pop the stack, maintaining references to 'top' and 'last'.
    _push: function push(arg) {
        this._top = {
            offset:     this._i,
            char:       arg,
            statements: [this._i],
            dots:       [],
            fullStatements: [],
            comma:      [],
            functions:  []
        };
        this._last = this._top.char;
        this._stack.push(this._top);
    },

    _pop: function pop(arg) {
        if (this._i == this.context.caret - 1)
            this.context.highlight(this._top.offset, 1, "FIND");

        if (this._top.char != arg) {
            this.context.highlight(this._top.offset, this._i - this._top.offset, "SPELLCHECK");
            throw Error("Invalid JS");
        }

        // The closing character of this stack frame will have pushed a new
        // statement, leaving us with an empty statement. This doesn't matter,
        // now, as we simply throw away the frame when we pop it, but it may later.
        if (this._top.statements[this._top.statements.length - 1] == this._i)
            this._top.statements.pop();
        this._top = this._get(-2);
        this._last = this._top.char;
        let ret = this._stack.pop();
        return ret;
    },

    _buildStack: function (filter) {
        // Todo: Fix these one-letter variable names.
        this._i = 0;
        this._c = ""; // Current index and character, respectively.

        // Reuse the old stack.
        if (this._str && filter.substr(0, this._str.length) == this._str) {
            this.context.highlight(0, 0, "FIND");
            this._i = this._str.length;
            if (this.popStatement)
                this._top.statements.pop();
        }
        else {
            this.context.highlight();
            this._stack = [];
            this._functions = [];
            this._push("#root");
        }

        // Build a parse stack, discarding entries as opening characters
        // match closing characters. The stack is walked from the top entry
        // and down as many levels as it takes us to figure out what it is
        // that we're completing.
        this._str = filter;
        let length = this._str.length;
        for (; this._i < length; this._lastChar = this._c, this._i++) {
            this._c = this._str[this._i];
            if (/['"\/]/.test(this._last)) {
                if (this._lastChar == "\\") { // Escape. Skip the next char, whatever it may be.
                    this._c = "";
                    this._i++;
                }
                else if (this._c == this._last)
                    this._pop(this._c);
            }
            else {
                // A word character following a non-word character, or simply a non-word
                // character. Start a new statement.
                if (/[a-zA-Z_$]/.test(this._c) && !/[\w$]/.test(this._lastChar) || !/[\w\s$]/.test(this._c))
                    this._top.statements.push(this._i);

                // A "." or a "[" dereferences the last "statement" and effectively
                // joins it to this logical statement.
                if ((this._c == "." || this._c == "[") && /[\w$\])"']/.test(this._lastNonwhite)
                || this._lastNonwhite == "." && /[a-zA-Z_$]/.test(this._c))
                        this._top.statements.pop();

                switch (this._c) {
                case "(":
                    // Function call, or if/while/for/...
                    if (/[\w$]/.test(this._lastNonwhite)) {
                        this._functions.push(this._i);
                        this._top.functions.push(this._i);
                        this._top.statements.pop();
                    }
                case '"':
                case "'":
                case "/":
                case "{":
                case "[":
                    this._push(this._c);
                    break;
                case ".":
                    this._top.dots.push(this._i);
                    break;
                case ")": this._pop("("); break;
                case "]": this._pop("["); break;
                case "}": this._pop("{"); // Fallthrough
                case ";":
                    this._top.fullStatements.push(this._i);
                    break;
                case ",":
                    this._top.comma.push(this._i);
                    break;
                }

                if (/\S/.test(this._c))
                    this._lastNonwhite = this._c;
            }
        }

        this.popStatement = false;
        if (!/[\w$]/.test(this._lastChar) && this._lastNonwhite != ".") {
            this.popStatement = true;
            this._top.statements.push(this._i);
        }

        this._lastIdx = this._i;
    },

    // Don't eval any function calls unless the user presses tab.
    _checkFunction: function (start, end, key) {
        let res = this._functions.some(function (idx) idx >= start && idx < end);
        if (!res || this.context.tabPressed || key in this.cache.evalled)
            return false;
        this.context.waitingForTab = true;
        return true;
    },

    // For each DOT in a statement, prefix it with TMP, eval it,
    // and save the result back to TMP. The point of this is to
    // cache the entire path through an object chain, mainly in
    // the presence of function calls. There are drawbacks. For
    // instance, if the value of a variable changes in the course
    // of inputting a command (let foo=bar; frob(foo); foo=foo.bar; ...),
    // we'll still use the old value. But, it's worth it.
    _getObj: function (frame, stop) {
        let statement = this._get(frame, 0, "statements") || 0; // Current statement.
        let prev = statement;
        let obj = this.window;
        let cacheKey;
        for (let [, dot] in Iterator(this._get(frame).dots.concat(stop))) {
            if (dot < statement)
                continue;
            if (dot > stop || dot <= prev)
                break;

            let s = this._str.substring(prev, dot);
            if (prev != statement)
                s = JavaScript.EVAL_TMP + "." + s;
            cacheKey = this._str.substring(statement, dot);

            if (this._checkFunction(prev, dot, cacheKey))
                return [];
            if (prev != statement && obj == null) {
                this.context.message = "Error: " + cacheKey.quote() + " is " + String(obj);
                return [];
            }

            prev = dot + 1;
            obj = this.evalled(s, cacheKey, obj);
        }
        return [[obj, cacheKey]];
    },

    _getObjKey: function (frame) {
        let dot = this._get(frame, 0, "dots") || -1; // Last dot in frame.
        let statement = this._get(frame, 0, "statements") || 0; // Current statement.
        let end = (frame == -1 ? this._lastIdx : this._get(frame + 1).offset);

        this._cacheKey = null;
        let obj = [[this.cache.evalContext, "Local Variables"],
                   [this.modules.userContext, "Global Variables"],
                   [this.modules, "modules"],
                   [this.window, "window"]]; // Default objects;
        // Is this an object dereference?
        if (dot < statement) // No.
            dot = statement - 1;
        else // Yes. Set the object to the string before the dot.
            obj = this._getObj(frame, dot);

        let [, space, key] = this._str.substring(dot + 1, end).match(/^(\s*)(.*)/);
        return [dot + 1 + space.length, obj, key];
    },

    _fill: function (context, args) {
        context.title = [args.name];
        context.anchored = args.anchored;
        context.filter = args.filter;
        context.itemCache = context.parent.itemCache;
        context.key = args.name + args.last;

        if (args.last == null)
            // We're not looking for a quoted string, so filter out anything that's not a valid identifier
            context.filters.push(function (item) /^[a-zA-Z_$][\w$]*$/.test(item.text));
        else {
            context.quote = [args.last, function (text) util.escapeString(text, ""), args.last];
            if (args.prefix)
                context.filters.push(function (item) item.item.indexOf(args.prefix) === 0);
        }

        args.completer.call(this, context, args);
    },

    _complete: function (objects, key, compl, string, last) {
        const self = this;

        if (!this.window.Object.getOwnPropertyNames && !services.debugger.isOn && !this.context.message)
            this.context.message = "For better completion data, please enable the JavaScript debugger (:set jsdebugger)";

        let orig = compl;
        if (!compl) {
            compl = function (context, args, recurse) {

                context.process[1] = function highlight(item, v)
                    template.highlight(typeof v == "xml" ? new String(v.toXMLString()) : v, true);

                // Sort in a logical fashion for object keys:
                //  Numbers are sorted as numbers, rather than strings, and appear first.
                //  Constants are unsorted, and appear before other non-null strings.
                //  Other strings are sorted in the default manner.
                let compare = context.compare;
                function isnan(item) item != '' && isNaN(item);
                context.compare = function (a, b) {
                    if (!isnan(a.key) && !isnan(b.key))
                        return a.key - b.key;
                    return isnan(b.key) - isnan(a.key) || compare(a, b);
                };
                context.keys = {
                    text: args.prefix ? function (text) text.substr(args.prefix.length) : util.identity,
                    description: function (item) self.getKey(args.obj, item),
                    key: function (item) {
                        if (!isNaN(key))
                            return parseInt(key);
                         if (/^[A-Z_][A-Z0-9_]*$/.test(key))
                            return "";
                        return item;
                    }
                };

                if (!context.anchored) // We've already listed anchored matches, so don't list them again here.
                    context.filters.push(function (item) util.compareIgnoreCase(item.text.substr(0, this.filter.length), this.filter));
                if (args.obj == self.cache.evalContext)
                    context.regenerate = true;
                context.generate = function () self.objectKeys(args.obj, !recurse);
            };
        }

        let args = {
            filter: last == null ? key : string,
            last: last,
            prefix: last != null ? key : ""
        };

        this.context.forceAnchored = true;
        // TODO: Make this a generic completion helper function.
        for (let [, obj] in Iterator(objects))
            this.context.fork(obj[1], this._top.offset, this, this._fill,
                update({
                    obj: obj[0],
                    name: obj[1],
                    anchored: true,
                    completer: compl
                }, args));

        if (orig)
            return;

        for (let [, obj] in Iterator(objects))
            this.context.fork(obj[1] + "/prototypes", this._top.offset, this, this._fill,
                update({
                    obj: obj[0],
                    name: obj[1] + " (prototypes)",
                    anchored: true,
                    completer: function (a, b) compl(a, b, true)
                }, args));

        for (let [, obj] in Iterator(objects))
            this.context.fork(obj[1] + "/substrings", this._top.offset, this, this._fill,
                update({
                    obj: obj[0],
                    name: obj[1] + " (substrings)",
                    anchored: false,
                    completer: compl
                }, args));

        for (let [, obj] in Iterator(objects))
            this.context.fork(obj[1] + "/prototypes/substrings", this._top.offset, this, this._fill,
                update({
                    obj: obj[0],
                    name: obj[1] + " (prototype substrings)",
                    anchored: false,
                    completer: function (a, b) compl(a, b, true)
                }, args));
    },

    _getKey: function () {
        if (this._last == "")
            return "";
        // After the opening [ upto the opening ", plus '' to take care of any operators before it
        let key = this._str.substring(this._get(-2, null, "offset") + 1, this._get(-1, null, "offset")) + "''";
        // Now eval the key, to process any referenced variables.
        return this.evalled(key);
    },

    get cache() this.context.cache,

    complete: function _complete(context) {
        const self = this;
        this.context = context;

        try {
            this._buildStack.call(this, context.filter);
        }
        catch (e) {
            this._lastIdx = 0;
            util.assert(!e.message, e.message);
            return null;
        }

        this.context.getCache("evalled", Object);
        this.context.getCache("evalContext", this.closure.newContext);

        // Okay, have parse stack. Figure out what we're completing.

        // Find any complete statements that we can eval before we eval our object.
        // This allows for things like:
        //   let doc = content.document; let elem = doc.createEle<Tab> ...
        let prev = 0;
        for (let [, v] in Iterator(this._get(0).fullStatements)) {
            let key = this._str.substring(prev, v + 1);
            if (this._checkFunction(prev, v, key))
                return null;
            this.evalled(key);
            prev = v + 1;
        }

        // If this is a function argument, try to get the function's
        // prototype and show it.
        try {
            let i = (this._get(-2) && this._get(-2).char == "(") ? -2 : -1;
            if (this._get(i).char == "(") {
                let [offset, obj, funcName] = this._getObjKey(i - 1);
                if (obj.length) {
                    let func = obj[0][0][funcName];
                    if (callable(func)) {
                        let [, prefix, args] = /^(function .*?)\((.*)?\)/.exec(Function.prototype.toString.call(func));
                        let n = this._get(i).comma.length;
                        args = template.map(Iterator(args.split(", ")),
                            function ([i, arg]) <span highlight={i == n ? "Filter" : ""}>{arg}</span>,
                            <>,&#xa0;</>);
                        this.context.message = <>{prefix}({args})</>;
                    }
                }
            }
        }
        catch (e) {}

        // In a string. Check if we're dereferencing an object or
        // completing a function argument. Otherwise, do nothing.
        if (this._last == "'" || this._last == '"') {

            // str = "foo[bar + 'baz"
            // obj = "foo"
            // key = "bar + ''"

            // The top of the stack is the sting we're completing.
            // Wrap it in its delimiters and eval it to process escape sequences.
            let string = this._str.substring(this._get(-1).offset + 1, this._lastIdx).replace(/((?:\\\\)*)\\/, "$1");
            string = Cu.evalInSandbox(this._last + string + this._last, this._nullSandbox);

            // Is this an object accessor?
            if (this._get(-2).char == "[") { // Are we inside of []?
                // Stack:
                //  [-1]: "...
                //  [-2]: [...
                //  [-3]: base statement

                // Yes. If the [ starts at the beginning of a logical
                // statement, we're in an array literal, and we're done.
                if (this._get(-3, 0, "statements") == this._get(-2).offset)
                    return null;

                // Beginning of the statement upto the opening [
                let obj = this._getObj(-3, this._get(-2).offset);

                return this._complete(obj, this._getKey(), null, string, this._last);
            }

            // Is this a function call?
            if (this._get(-2).char == "(") {
                // Stack:
                //  [-1]: "...
                //  [-2]: (...
                //  [-3]: base statement

                // Does the opening "(" mark a function call?
                if (this._get(-3, 0, "functions") != this._get(-2).offset)
                    return null; // No. We're done.

                let [offset, obj, funcName] = this._getObjKey(-3);
                if (!obj.length)
                    return null;
                obj = obj.slice(0, 1);

                try {
                    let func = obj[0][0][funcName];
                    var completer = func.dactylCompleter;
                }
                catch (e) {}
                if (!completer)
                    completer = JavaScript.completers[funcName];
                if (!completer)
                    return null;

                // Split up the arguments
                let prev = this._get(-2).offset;
                let args = [];
                for (let [i, idx] in Iterator(this._get(-2).comma)) {
                    let arg = this._str.substring(prev + 1, idx);
                    prev = idx;
                    memoize(args, i, function () self.evalled(arg));
                }
                let key = this._getKey();
                args.push(key + string);

                let compl = function (context, obj) {
                    let res = completer.call(self, context, funcName, obj.obj, args);
                    if (res)
                        context.completions = res;
                };

                obj[0][1] += "." + funcName + "(... [" + args.length + "]";
                return this._complete(obj, key, compl, string, this._last);
            }

            // In a string that's not an obj key or a function arg.
            // Nothing to do.
            return null;
        }

        // str = "foo.bar.baz"
        // obj = "foo.bar"
        // key = "baz"
        //
        // str = "foo"
        // obj = [modules, window]
        // key = "foo"

        let [offset, obj, key] = this._getObjKey(-1);

        // Wait for a keypress before completing when there's no key
        if (!this.context.tabPressed && key == "" && obj.length > 1) {
            this.context.waitingForTab = true;
            this.context.message = "Waiting for key press";
            return null;
        }

        if (!/^(?:[a-zA-Z_$][\w$]*)?$/.test(key))
            return null; // Not a word. Forget it. Can this even happen?

        try { // FIXME
            var o = this._top.offset;
            this._top.offset = offset;
            return this._complete(obj, key);
        }
        finally {
            this._top.offset = o;
        }
        return null;
    },

    magicalNames: Class.memoize(function () Object.getOwnPropertyNames(Cu.Sandbox(this.window), true).sort()),

    /**
     * A list of properties of the global object which are not
     * enumerable by any standard method.
     */
    globalNames: Class.memoize(function () let (self = this) array.uniq([
        "Array", "ArrayBuffer", "AttributeName", "Boolean", "Components",
        "CSSFontFaceStyleDecl", "CSSGroupRuleRuleList", "CSSNameSpaceRule",
        "CSSRGBColor", "CSSRect", "ComputedCSSStyleDeclaration", "Date",
        "Error", "EvalError", "Float32Array", "Float64Array", "Function",
        "HTMLDelElement", "HTMLInsElement", "Infinity",
        "InnerModalContentWindow", "InnerWindow", "Int16Array", "Int32Array",
        "Int8Array", "InternalError", "Iterator", "JSON", "KeyboardEvent",
        "Math", "NaN", "Namespace", "Number", "Object", "Proxy", "QName",
        "ROCSSPrimitiveValue", "RangeError", "ReferenceError", "RegExp",
        "StopIteration", "String", "SyntaxError", "TypeError", "URIError",
        "Uint16Array", "Uint32Array", "Uint8Array", "XML",
        "XMLHttpProgressEvent", "XMLList", "XMLSerializer", "XPCNativeWrapper",
        "XPCSafeJSWrapper", "XULControllers", "decodeURI", "decodeURIComponent",
        "encodeURI", "encodeURIComponent", "eval", "isFinite", "isNaN",
        "isXMLName", "parseFloat", "parseInt", "undefined", "uneval"
    ].concat([k.substr(6) for (k in keys(Ci)) if (/^nsIDOM/.test(k))])
     .concat([k.substr(3) for (k in keys(Ci)) if (/^nsI/.test(k))])
     .concat(this.magicalNames)
     .filter(function (k) k in self.window))),

}, {
    EVAL_TMP: "__dactyl_eval_tmp",
    EVAL_EXPORT: "__dactyl_eval_export",

    /**
     * A map of argument completion functions for named methods. The
     * signature and specification of the completion function
     * are fairly complex and yet undocumented.
     *
     * @see JavaScript.setCompleter
     */
    completers: {},

    /**
     * Installs argument string completers for a set of functions.
     * The second argument is an array of functions (or null
     * values), each corresponding the argument of the same index.
     * Each provided completion function receives as arguments a
     * CompletionContext, the 'this' object of the method, and an
     * array of values for the preceding arguments.
     *
     * It is important to note that values in the arguments array
     * provided to the completers are lazily evaluated the first
     * time they are accessed, so they should be accessed
     * judiciously.
     *
     * @param {function|function[]} funcs The functions for which to
     *      install the completers.
     * @param {function[]} completers An array of completer
     *      functions.
     */
    setCompleter: function (funcs, completers) {
        funcs = Array.concat(funcs);
        for (let [, func] in Iterator(funcs)) {
            func.dactylCompleter = function (context, func, obj, args) {
                let completer = completers[args.length - 1];
                if (!completer)
                    return [];
                return completer.call(obj, context, obj, args);
            };
        }
        return arguments[0];
    }
}, {
    init: function init(dactyl, modules, window) {
        init.superapply(this, arguments);
    },
    completion: function (dactyl, modules, window) {
        const { completion, javascript } = modules;
        completion.javascript = javascript.closure.complete;
        completion.javascriptCompleter = JavaScript; // Backwards compatibility.
    },
    options: function (dactyl, modules, window) {
        modules.options.add(["jsdebugger", "jsd"],
            "Enable the JavaScript debugger service for use in JavaScript completion",
            "boolean", false, {
                setter: function (value) {
                    if (services.debugger.isOn != value)
                        if (value)
                            (services.debugger.asyncOn || services.debugger.on)(null);
                        else
                            services.debugger.off();
                },
                getter: function () services.debugger.isOn
            });
    }
});

endModule();

} catch(e){ if (!e.stack) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
