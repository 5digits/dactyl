ROOT = ..

XPTDIR          = $(ROOT)/components/
SODIR           = $(ROOT)/components/$(ABI)/
OBJDIR          = $(ABI)/

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
HEADERS = $(XPIDLSRCS:%.idl=$(ABI)/%.h)


all: build

dirs: $(XPTDIR) $(SODIR) $(OBJDIR)

depend: .depend

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

$(XPTDIR) $(SODIR) $(OBJDIR):
	mkdir -p $@
.PHONY: module xpts build clean all depend

sinclude .depend
