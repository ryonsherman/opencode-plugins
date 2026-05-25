PLUGIN_DIR := $(HOME)/.config/opencode/plugins
PLUGINS := $(wildcard plugins/*.ts)
PLUGIN_NAMES := $(notdir $(basename $(PLUGINS)))

.PHONY: install uninstall list installed instructions help $(addprefix install-,$(PLUGIN_NAMES)) $(addprefix uninstall-,$(PLUGIN_NAMES))

help:
	@echo "Usage:"
	@echo "  make install              Install all plugins"
	@echo "  make install-<name>       Install a specific plugin"
	@echo "  make uninstall            Uninstall all plugins"
	@echo "  make uninstall-<name>     Uninstall a specific plugin"
	@echo "  make list                 List available plugins"
	@echo "  make installed            Show installed plugins"
	@echo "  make instructions         Show how to set up instructions"
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
DESC_error-journal := Persistent error log with FTS search, resolution tracking, and pattern matching
DESC_git-context := Git repo state: branch, commits, dirty files, remote status, stashes
DESC_hash-encode := Cryptographic hashing (md5/sha1/sha256/sha512), HMAC, and encode/decode (base64/url/hex)
DESC_json-toolkit := Validate, format, minify, and query JSON strings
DESC_project-profile := Auto-detect project metadata (languages, framework, scripts) with manual conventions
DESC_regex-tester := Test, replace, and explain regular expressions using native RegExp
DESC_session-memory := Persistent session memory with FTS5 search, tags, scopes, and cross-session recall

list:
	@echo "Available plugins:"
	@$(foreach name,$(PLUGIN_NAMES),printf "  %-20s %s\n" "$(name)" "$(DESC_$(name))";)

installed:
	@echo "Installed plugins ($(PLUGIN_DIR)):"
	@found=0; $(foreach name,$(PLUGIN_NAMES),if [ -f "$(PLUGIN_DIR)/$(name).ts" ]; then printf "  %-20s %s\n" "$(name)" "$(DESC_$(name))"; found=1; fi;) if [ "$$found" = "0" ]; then echo "  (none)"; fi

instructions:
	@echo "To configure plugin instructions for OpenCode:"
	@echo ""
	@echo "  1. Open your global instructions file:"
	@echo "     ~/.config/opencode/instructions.md"
	@echo ""
	@echo "  2. Append the relevant sections from this repo's instructions file:"
	@echo "     ./instructions.md"
	@echo ""
	@echo "  3. Only include sections for plugins you have installed."
	@echo "     Each section is marked with which plugin file it requires."
	@echo ""
	@echo "  Example:"
	@echo "     cat ./instructions.md >> ~/.config/opencode/instructions.md"
	@echo ""
	@echo "  Or selectively copy the sections you need into your global file."
