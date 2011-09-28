
#pragma once

#include "config.h"
#include "dactylIUtils.h"

#include "nsISupports.h"
#include "nsIPrincipal.h"
#include "nsIXPConnect.h"

#include "jsapi.h"
#include "jsfriendapi.h"
#include "nsIJSRuntimeService.h"
#include "nsIJSContextStack.h"

#include "nsCOMPtr.h"

class dactylUtils : public dactylIUtils {
public:
    dactylUtils() NS_HIDDEN;
    ~dactylUtils() NS_HIDDEN;

    NS_DECL_ISUPPORTS
    NS_DECL_DACTYLIUTILS

    NS_HIDDEN_(nsresult) Init();

private:

    nsCOMPtr<nsIJSRuntimeService> mRuntimeService;
    JSRuntime *mRuntime;

    nsCOMPtr<nsIPrincipal> mSystemPrincipal;
};

/* vim:se sts=4 sw=4 et cin ft=cpp: */
