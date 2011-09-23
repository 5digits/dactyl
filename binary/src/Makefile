ROOT = ..

XPTDIR          = $(ROOT)/components/
SODIR           = $(ROOT)/components/$(PLATFORM)/
OBJDIR          = $(PLATFORM)/

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

GECKO_CONFIG_INCLUDE = -include mozilla-config.h

GECKO_DEFINES  = -DMOZILLA_STRICT_API

GECKO_INCLUDES = -I$(PLATFORM)/			\
		 -I$(GECKO_SDK_PATH)		\
                 -I$(GECKO_SDK_PATH)/idl	\
                 -I$(GECKO_SDK_PATH)/include

GECKO_LDFLAGS =  -L$(GECKO_SDK_PATH)/bin \
		 -L$(GECKO_SDK_PATH)/lib \
		 -lxpcomglue_s	\
                 -lnspr4	\
                 -lplds4	\
		 -lxul		\
		 -shared	\
		 $(NULL)

include $(ROOT)/config.mk
sinclude $(ROOT)/config.local.mk

XPTS = $(XPIDLSRCS:%.idl=$(XPTDIR)%.xpt)
OBJS = $(CPPSRCS:%.cpp=$(OBJDIR)%.o)
HEADERS = $(XPIDLSRCS:%.idl=$(PLATFORM)/%.h)

all: build

$(OBJS): $(HEADERS)

$(PLATFORM)/%.h: %.idl
	$(IDL_H) $@ $(GECKO_INCLUDES) $<

$(XPTDIR)%.xpt: %.idl
	$(IDL_XPT) $@ $(GECKO_INCLUDES) $<

depend: .depend

_CPPFLAGS = $(CPPFLAGS) $(CXXFLAGS) $(GECKO_CONFIG_INCLUDE) $(GECKO_DEFINES) $(GECKO_INCLUDES) $(DEFINES)

$(OBJDIR)%.o: %.cpp Makefile
	$(CXX) -o $@ -c $(_CPPFLAGS) $<

.depend: $(CPPSRCS) Makefile
	$(MKDEP) $(_CPPFLAGS) $(CPPSRCS) | $(SED) 's;^[^ ];$(OBJDIR)&;' >.depend

$(MODULE).so: $(OBJS)
	$(CXX) -o $@ -Wl,-soname=$(MODULE).so $(OBJS) $(GECKO_LDFLAGS)
	chmod +x $@

dirs: $(XPTDIR) $(SODIR) $(OBJDIR)

$(XPTDIR) $(SODIR) $(OBJDIR):
	mkdir -p $@

build: dirs $(XPTS) $(MODULE).so

clean:
	rm $(MODULE).so

sinclude .depend
