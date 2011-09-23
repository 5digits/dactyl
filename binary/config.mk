
PLATFORM = 9.0-Linux_x86_64-gcc3
DEFINES  = -DGECKO_MAJOR=9 -DGECKO_MINOR=0

SED	 ?= sed -r

GECKO_SDK_PATH := $(shell pkg-config --libs libxul | $(SED) 's,([^-]|-[^L])*-L([^ ]+)/lib.*,\2,')

CXX      ?= c++

MKDEP    ?= $(CXX) -M

PYTHON   ?= python2

CPPFLAGS +=     -fno-rtti		\
                -fno-exceptions		\
                -fshort-wchar		\
		-fPIC			\
		$(NULL)

XPIDL   ?= $(PYTHON) $(GECKO_SDK_PATH)/sdk/bin
IDL_H   ?= $(XPIDL)/header.py -o
IDL_XPT ?= $(XPIDL)/typelib.py -o

