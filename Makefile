# Copyright (c) 2026 The Orbit Authors
# SPDX-License-Identifier: Apache-2.0

SHELL := bash

DOC_ROOT=docs

%.md : %.adoc
	asciidoctor -b docbook -a leveloffset=+1 -o - $< | pandoc -t markdown_strict --wrap=none -f docbook > $@
	-git commit $@ $< -m "Update doc: $<"
csvs := $(wildcard ${DOC_ROOT}/*/*.csv)
docs := $(patsubst %.adoc,%.md,$(wildcard ${DOC_ROOT}/*.adoc))
doc-touch: $(csvs)
	@touch ${DOC_ROOT}/*.adoc

.PHONY: oclif-docs
oclif-docs:
	npm run docs:commands

doc: doc-touch oclif-docs $(docs)

.PHONY: deps
deps:
	npm ci --include=dev

.PHONY: build
build: deps
	npm ci
	npm run build

.PHONY: link
link: build
	npm link

.PHONY: run
run: build
	node ./bin/run.js $(ARGS)

.PHONY: gui
gui: build
	node ./bin/run.js gui $(ARGS)

.PHONY: run
cli: run
