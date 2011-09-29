ROOT = ..

XPTDIR		= $(ROOT)/components/$(ABI)/
SODIR		= $(ROOT)/components/$(ABI)/
OBJDIR		= $(ABI)/

MODULE		= $(SODIR)dactyl

XPIDLSRCS	= \
		dactylIUtils.idl \
		$(NULL)

CPPSRCS		= \
		dactylModule.cpp \
		dactylUtils.cpp \
		mozJSLoaderUtils.cpp \
		subscriptLoader.cpp \
		$(NULL)

HEADERS		= \
		  config.h		\
		  dactylUtils.h		\
		  mozJSLoaderUtils.h	\
	 	  $(XPIDLSRCS:%.idl=$(ABI)/%.h)

GECKO_DEFINES  = -DMOZILLA_STRICT_API

GECKO_INCLUDES = -I$(ABI)/			\
		 -I$(GECKO_SDK_PATH)		\
		 -I$(GECKO_SDK_PATH)/idl	\
		 -I$(GECKO_SDK_PATH)/include

GECKO_LDFLAGS =  -L$(GECKO_SDK_PATH)/bin \
		 -L$(GECKO_SDK_PATH)/lib \
		 -lxpcomglue_s	\
		 -lxpcom	\
		 -lnspr4	\
		 -shared	\
		 $(NULL)

ifeq "$(shell uname -s)" "Darwin"
	GECKO_LDFLAGS += -undefined dynamic_lookup
endif

include $(ROOT)/config.mk
sinclude $(ROOT)/config.local.mk

CPPFLAGS += $(EXCPPFLAGS)

XPTS = $(XPIDLSRCS:%.idl=$(XPTDIR)%.xpt)
OBJS = $(CPPSRCS:%.cpp=$(OBJDIR)%.o)
MANIFEST = $(SODIR)/components.manifest

all: build manifest

dirs: $(XPTDIR) $(SODIR) $(OBJDIR)

depend: .depend

manifest: $(MANIFEST)

module: dirs $(MODULE).so

dll: dirs $(MODULE).dll

xpts: $(XPTS)

build: dirs module xpts

clean:
	rm $(MODULE).so


$(OBJS): $(HEADERS)

$(ABI)/%.h: %.idl
	$(IDL_H) $@ $(GECKO_INCLUDES) $<

$(XPTDIR)%.xpt: %.idl
	$(IDL_XPT) $@ $(GECKO_INCLUDES) $<

$(MANIFEST): Makefile
	( echo interfaces $(XPIDLSRCS:.idl=.xpt);	\
	  echo binary-component $(MODULE:$(SODIR)%=%).$(LIBEXT) )	\
	    >$@
	
	manifest=$(SODIR)/../gecko-$(GECKO_MAJOR).manifest; 			\
	if [ $(GECKO_MAJOR) -lt 8 ]; then part=app; else part=platform; fi; 	\
	line="manifest $(ABI)/components.manifest abi=$(ABI_PLATFORM) $${part}version<$(GECKO_MAJOR).*";	\
	grep >/dev/null 2>&1 "^$$line$$" $$manifest || echo $$line >>$$manifest

_CPPFLAGS = $(CPPFLAGS) $(CXXFLAGS) $(GECKO_DEFINES) $(GECKO_INCLUDES) $(DEFINES)

$(OBJDIR)%.o: %.cpp Makefile
	$(CPP)$@ -c $(_CPPFLAGS) $<

.depend: $(CPPSRCS) Makefile
	$(MKDEP) $(_CPPFLAGS) $(CPPSRCS) | $(SED) 's;^[^ ];$(OBJDIR)&;' >.depend

$(MODULE).so: $(OBJS)
	$(LINK) -o $@ $(OBJS) $(LDFLAGS) $(GECKO_LDFLAGS)
	chmod +x $@

$(MODULE).dll: $(OBJS)
	$(LINK)$@ $(GECKO_LDFLAGS) $(OBJS)

$(sort $(XPTDIR) $(SODIR) $(OBJDIR)):
	mkdir -p $@
.PHONY: module xpts build clean all depend manifest

sinclude .depend
