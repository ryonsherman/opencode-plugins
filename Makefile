PLUGIN_DIR := $(HOME)/.config/opencode/plugins
PLUGINS := $(wildcard plugins/*.ts)
PLUGIN_NAMES := $(notdir $(basename $(PLUGINS)))

.PHONY: install uninstall list installed help $(addprefix install-,$(PLUGIN_NAMES)) $(addprefix uninstall-,$(PLUGIN_NAMES))

help:
	@echo "Usage:"
	@echo "  make install            Install all plugins"
	@echo "  make install-<name>     Install a specific plugin"
	@echo "  make uninstall          Uninstall all plugins"
	@echo "  make uninstall-<name>   Uninstall a specific plugin"
	@echo "  make list               List available plugins"
	@echo "  make installed          Show installed plugins"
	@echo ""
	@$(MAKE) --no-print-directory list

install: $(addprefix install-,$(PLUGIN_NAMES))

uninstall: $(addprefix uninstall-,$(PLUGIN_NAMES))

define PLUGIN_RULES
install-$(1):
	@mkdir -p $(PLUGIN_DIR)
	@cp plugins/$(1).ts $(PLUGIN_DIR)/$(1).ts
	@echo "Installed $(1)"

uninstall-$(1):
	@rm -f $(PLUGIN_DIR)/$(1).ts
	@echo "Uninstalled $(1)"
endef

$(foreach name,$(PLUGIN_NAMES),$(eval $(call PLUGIN_RULES,$(name))))

DESC_codebase-index := Local codebase indexing and full-text search over source files
DESC_git-context := Git repo state: branch, commits, dirty files, remote status, stashes
DESC_session-memory := Persistent session memory with FTS5 search, tags, scopes, and cross-session recall

list:
	@echo "Available plugins:"
	@$(foreach name,$(PLUGIN_NAMES),printf "  %-20s %s\n" "$(name)" "$(DESC_$(name))";)

installed:
	@echo "Installed plugins ($(PLUGIN_DIR)):"
	@found=0; $(foreach name,$(PLUGIN_NAMES),if [ -f "$(PLUGIN_DIR)/$(name).ts" ]; then printf "  %-20s %s\n" "$(name)" "$(DESC_$(name))"; found=1; fi;) if [ "$$found" = "0" ]; then echo "  (none)"; fi
