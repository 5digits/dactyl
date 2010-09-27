// Copyright ©2008-2010 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

Components.utils.import("resource://dactyl/base.jsm");
defineModule("bookmarkcache", {
    exports: ["Bookmark", "BookmarkCache", "Keyword", "bookmarkcache"],
    require: ["services", "storage", "util"]
});


const Bookmark = Struct("url", "title", "icon", "keyword", "tags", "id");
const Keyword = Struct("keyword", "title", "icon", "url");
Bookmark.defaultValue("icon", function () BookmarkCache.getFavicon(this.url));
Bookmark.prototype.__defineGetter__("extra", function () [
                        ["keyword", this.keyword,         "Keyword"],
                        ["tags",    this.tags.join(", "), "Tag"]
                    ].filter(function (item) item[1]));

const bookmarks = services.get("bookmarks");
const history   = services.get("history");
const tagging   = services.get("tagging");
const name      = "bookmark-cache";

const BookmarkCache = Module("BookmarkCache", {
    init: function init() {
        bookmarks.addObserver(this, false);
    },

    __iterator__: function () (val for ([, val] in Iterator(bookmarkcache.bookmarks))),

    get bookmarks() Class.replaceProperty(this, "bookmarks", this.load()),

    rootFolders: ["toolbarFolder", "bookmarksMenuFolder", "unfiledBookmarksFolder"]
        .map(function (s) bookmarks[s]),

    _deleteBookmark: function deleteBookmark(id) {
        let length = this.bookmarks.length;
        let result;
        this.bookmarks = this.bookmarks.filter(function (item) {
            if (item.id == id)
                result = item;
            return item.id != id;
        });
        return result;
    },

    _loadBookmark: function loadBookmark(node) {
        if (node.uri == null) // How does this happen?
            return false;
        let uri = util.newURI(node.uri);
        let keyword = bookmarks.getKeywordForBookmark(node.itemId);
        let tags = tagging.getTagsForURI(uri, {}) || [];
        return Bookmark(node.uri, node.title, node.icon && node.icon.spec, keyword, tags, node.itemId);
    },

    readBookmark: function readBookmark(id) {
        return {
            itemId: id,
            uri:    bookmarks.getBookmarkURI(id).spec,
            title:  bookmarks.getItemTitle(id)
        };
    },

    findRoot: function findRoot(id) {
        do {
            var root = id;
            id = bookmarks.getFolderIdForItem(id);
        } while (id != bookmarks.placesRoot && id != root);
        return root;
    },

    isBookmark: function (id) this.rootFolders.indexOf(this.findRoot(id)) >= 0,

    isRegularBookmark: function isRegularBookmark(id) {
        do {
            var root = id;
            if (services.get("livemark") && services.get("livemark").isLivemark(id))
                return false;
            id = bookmarks.getFolderIdForItem(id);
        } while (id != bookmarks.placesRoot && id != root);
        return this.rootFolders.indexOf(root) >= 0;
    },

    get keywords() [Keyword(k.keyword, k.title, k.icon, k.url) for ([, k] in Iterator(this.bookmarks)) if (k.keyword)],

    // Should be made thread safe.
    load: function load() {
        let bookmarks = [];

        let folders = this.rootFolders.slice();
        let query = history.getNewQuery();
        let options = history.getNewQueryOptions();
        while (folders.length > 0) {
            query.setFolders(folders, 1);
            folders.shift();
            let result = history.executeQuery(query, options);
            let folder = result.root;
            folder.containerOpen = true;

            // iterate over the immediate children of this folder
            for (let i = 0; i < folder.childCount; i++) {
                let node = folder.getChild(i);
                if (node.type == node.RESULT_TYPE_FOLDER)   // folder
                    folders.push(node.itemId);
                else if (node.type == node.RESULT_TYPE_URI) // bookmark
                    bookmarks.push(this._loadBookmark(node));
            }

            // close a container after using it!
            folder.containerOpen = false;
        }

        return bookmarks;
    },

    onBeforeItemRemoved: function () {},
    onBeginUpdateBatch:  function () {},
    onEndUpdateBatch:    function () {},
    onItemVisited:       function () {},
    onItemMoved:         function () {},
    onItemAdded: function onItemAdded(itemId, folder, index) {
        if (bookmarks.getItemType(itemId) == bookmarks.TYPE_BOOKMARK) {
            if (this.isBookmark(itemId)) {
                let bmark = this._loadBookmark(this.readBookmark(itemId));
                this.bookmarks.push(bmark);
                storage.fireEvent(name, "add", bmark);
            }
        }
    },
    onItemRemoved: function onItemRemoved(itemId, folder, index) {
        let result = this._deleteBookmark(itemId);
        if (result)
            storage.fireEvent(name, "remove", result);
    },
    onItemChanged: function onItemChanged(itemId, property, isAnnotation, value) {
        if (isAnnotation)
            return;
        let bookmark = bookmarkcache.bookmarks.filter(function (item) item.id == itemId)[0];
        if (bookmark) {
            if (property == "tags")
                value = tagging.getTagsForURI(util.newURI(bookmark.url), {});
            if (property in bookmark) {
                bookmark[property] = value;
                storage.fireEvent(name, "change", { __proto__: bookmark, changed: property });
            }
        }
    },
    QueryInterface: XPCOMUtils.generateQI([Ci.nsINavBookmarkObserver])
}, {
    getFavicon: function getFavicon(uri) {
        try {
            return service.get("favicon").getFaviconImageForPage(util.newURI(uri)).spec;
        }
        catch (e) {
            return "";
        }
    }
});

endModule();

// vim: set fdm=marker sw=4 sts=4 et ft=javascript:
