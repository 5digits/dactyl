
// Work around these horrendous Sandbox issues.
Components.utils.import(/([^ ]+\/)[^\/]+$/.exec(Components.stack.filename)[1] + "utils.jsm", exports);

// vim: sw=4 ts=8 et:
