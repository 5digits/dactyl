/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 *
 * ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is mozilla.org.
 *
 * The Initial Developer of the Original Code is
 * Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Michael Wu <mwu@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either of the GNU General Public License Version 2 or later (the "GPL"),
 * or the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

#ifndef mozJSLoaderUtils_h
#define mozJSLoaderUtils_h

#include "config.h"

/*
 * This is evil. Very evil.
#define nsString_h___
#include "nsStringGlue.h"
 */

#include "nsIStartupCache.h"
#include "nsStringAPI.h"
#include "jsapi.h"

#if defined(GECKO_MAJOR) && GECKO_MAJOR < 9
#include "jsapi.h"
#   define JS_XDRScript JS_XDRScriptObject
    typedef JSObject JSScriptType;

#   if GECKO_MAJOR < 8
#   define NewObjectInputStreamFromBuffer NS_NewObjectInputStreamFromBuffer
#   define NewBufferFromStorageStream NS_NewBufferFromStorageStream
#      if GECKO_MAJOR > 6
#          define NewObjectOutputWrappedStorageStream NS_NewObjectOutputWrappedStorageStream
#      else
#          define NewObjectOutputWrappedStorageStream(a, b, c) NS_NewObjectOutputWrappedStorageStream((a), (b))
#      endif
#   endif
#else
    typedef JSScript JSScriptType;
#endif

class nsIURI;

namespace mozilla {
namespace scache {
class StartupCache;
}
}

nsresult
ReadCachedScript(nsIStartupCache* cache, nsACString &uri,
                 JSContext *cx, JSScriptType **scriptObj);

nsresult
WriteCachedScript(nsIStartupCache* cache, nsACString &uri,
                  JSContext *cx, JSScriptType *scriptObj);
#endif /* mozJSLoaderUtils_h */
