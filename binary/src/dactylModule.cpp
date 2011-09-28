#include "dactylUtils.h"

#include "mozilla/ModuleUtils.h"

#define NS_DACTYLUTILS_CID \
{ 0x4d55a47c, 0x0627, 0x4339, \
    { 0x97, 0x91, 0x52, 0xef, 0x5e, 0xd4, 0xc3, 0xd1 } }

#define NS_DACTYLUTILS_CONTRACTID \
    "@dactyl.googlecode.com/extra/utils"

NS_GENERIC_FACTORY_CONSTRUCTOR_INIT(dactylUtils, Init)

NS_DEFINE_NAMED_CID(NS_DACTYLUTILS_CID);

static const mozilla::Module::CIDEntry kDactylCIDs[] = {
    { &kNS_DACTYLUTILS_CID, true, NULL, dactylUtilsConstructor },
    { NULL }
};

static const mozilla::Module::ContractIDEntry kDactylContracts[] = {
    { NS_DACTYLUTILS_CONTRACTID, &kNS_DACTYLUTILS_CID },
    { NULL }
};

static const mozilla::Module::CategoryEntry kDactylCategories[] = {
    { NULL }
};

static const mozilla::Module kDactylUtilsModule = {
    mozilla::Module::kVersion,
    kDactylCIDs,
    kDactylContracts,
    kDactylCategories,
    NULL,
    NULL,
    NULL
};

NSMODULE_DEFN(dactylUtilsModule) = &kDactylUtilsModule;

/* vim:se sts=4 sw=4 et cin ft=cpp: */
