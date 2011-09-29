
GECKO_MAJOR ?= 10
GECKO_MINOR ?= 0
ABI_OS        := $(shell uname -s)
ABI_ARCH      := $(shell uname -m)
ABI_COMPILER  := gcc3
ABI_PLATFORM  ?= $(ABI_OS)_$(ABI_ARCH)-$(ABI_COMPILER)
ABI           ?= $(GECKO_MAJOR).$(GECKO_MINOR)-$(ABI_PLATFORM)
DEFINES        = -DGECKO_MAJOR=$(GECKO_MAJOR) -DGECKO_MINOR=$(GECKO_MINOR)

LIBEXT	      ?= so

SED := $(shell if [ "xoo" = x$$(echo foo | sed -E 's/f(o)/\1/' 2>/dev/null) ];	\
	       then echo sed -E; else echo sed -r;				\
	       fi)


PKGCONFIG      ?= pkg-config
GECKO_SDK_PATH := $(shell $(PKGCONFIG) --libs libxul | $(SED) 's,([^-]|-[^L])*-L([^ ]+)/lib.*,\2,')

CXX      ?= c++
CPP       = $(CXX) -o
LINK     ?= c++

MKDEP    ?= $(CXX) -M

PYTHON   ?= python2

EXCPPFLAGS =    -fno-rtti		\
                -fno-exceptions		\
                -fshort-wchar		\
		-fPIC			\
		-Os			\
		$(NULL)

XPIDL   ?= $(PYTHON) $(GECKO_SDK_PATH)/sdk/bin
IDL_H   ?= $(XPIDL)/header.py -o
IDL_XPT ?= $(XPIDL)/typelib.py -o

