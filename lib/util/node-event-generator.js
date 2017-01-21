/**
 * @fileoverview The event generator for AST nodes.
 * @author Toru Nagashima
 */

"use strict";

const lodash = require("lodash");
const parseSelector = require("../query-selectors/parser").parse;
const matchResultCache = new WeakMap();

/**
* Checks if a selector matches a node. Results are cached.
* @param {Object} selector The parsed selector
* @param {ASTNode} node The node
* @returns {boolean} `true` if the selector matches the node
*/
function checkMatch(selector, node) {
    if (!matchResultCache.has(selector)) {
        matchResultCache.set(selector, new WeakMap());
    }
    if (!matchResultCache.get(selector).has(node)) {
        matchResultCache.get(selector).set(node, checkMatchWithoutCache(selector, node)); // eslint-disable-line no-use-before-define
    }
    return matchResultCache.get(selector).get(node);
}

const ancestorMatchCache = new WeakMap();

/**
* Checks if a selector matches any of a node's ancestors, excluding the node itself.
* @param {Object} selector The parsed selector
* @param {ASTNode} node The node
* @returns {boolean} `true` if the selector matches any of the node's ancestors
*/
function checkMatchWithAnyAncestor(selector, node) {
    if (!node) {
        return false;
    }
    if (!ancestorMatchCache.has(selector)) {
        matchResultCache.set(selector, new WeakMap());
    }
    if (!ancestorMatchCache.get(selector).has(node)) {
        ancestorMatchCache.get(selector).set(node, checkMatch(selector, node.parent) || checkMatchWithAnyAncestor(selector, node.parent));
    }
    return ancestorMatchCache.get(selector).get(node);
}

/**
* Checks if a selector matches a node, without caching.
* @param {Object} selector The parsed selector
* @param {ASTNode} node The node
* @returns {boolean} `true` if the selector matches the node
*/
function checkMatchWithoutCache(selector, node) {
    switch (selector.type) {
        case "identifier": // e.g. Foo
            return node.type === selector.value;

        case "attribute": { // e.g. [params.length = 3]
            const propValue = lodash.get(node, selector.name);

            if (!selector.operator) {
                return !!propValue;
            }

            if (selector.value.type === "regexp") {
                return selector.value.value.test(propValue);
            }

            switch (selector.operator) {
                case "=":
                    return propValue === selector.value.value;
                case "!=":
                    return propValue !== selector.value.value;
                case "<":
                    return propValue < selector.value.value;
                case "<=":
                    return propValue <= selector.value.value;
                case ">":
                    return propValue > selector.value.value;
                case ">=":
                    return propValue >= selector.value.value;

                // no default
            }

            throw new TypeError(`Unexpected internal error: Unknown attribute selector operator ${selector.operator}`);
        }

        case "field": { // e.g. .consequent
            let currentAncestor = node;

            for (const field of selector.name.split(".").reverse()) {
                if (!currentAncestor.parent || currentAncestor !== currentAncestor.parent[field]) {
                    return false;
                }
                currentAncestor = currentAncestor.parent;
            }
            return true;
        }

        case "wildcard": // e.g. *
            return true;

        case "child": // e.g. Foo > Bar

            // Match the right side first; the chain will be shorter and it will cause an early exit faster.
            // Related: https://stackoverflow.com/questions/5797014/why-do-browsers-match-css-selectors-from-right-to-left
            return checkMatch(selector.right, node) && checkMatch(selector.left, node.parent);

        case "descendant": // e.g. Foo Bar
            return checkMatch(selector.right, node) && checkMatchWithAnyAncestor(selector.left, node);

        case "compound": // e.g. Foo[bar=1]
            return selector.selectors.every(child => checkMatch(child, node));

        case "matches": // e.g. Foo, Bar
            return selector.selectors.some(child => checkMatch(child, node));

        // no default
    }

    throw new TypeError(`Unexpected internal error: Unknown selector type ${selector.type}`);
}

/**
* Returns a list of all possible node types that a selector can match.
* This is used as a heuristic to avoid running every selector on every node.
* If `null` is returned, the selector will checked on every node.
* @param {Object} selector The parsed selector
* @returns {string[]} A list of node types that the selector could possibly fire on, or `null` if it should be checked on every node
*/
function getNodeTypesHint(selector) {
    switch (selector.type) {
        case "identifier":
            return [selector.value];

        case "child":
        case "descendant":
            return getNodeTypesHint(selector.right);

        case "compound":
            return lodash.intersection.apply(null, selector.selectors.map(getNodeTypesHint).filter(Boolean));

        case "matches":
            return lodash.union.apply(null, selector.selectors.map(getNodeTypesHint));

        default:
            return null;
    }
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * The event generator for AST nodes.
 * This implements below interface.
 *
 * ```ts
 * interface EventGenerator {
 *     emitter: EventEmitter;
 *     enterNode(node: ASTNode): void;
 *     leaveNode(node: ASTNode): void;
 * }
 * ```
 *
 * @param {EventEmitter} emitter - An event emitter which is the destination of events.
 * @param {Set<string>} selectors A list of query selector strings to detect and emit
 * @returns {NodeEventGenerator} new instance.
 */
module.exports = class NodeEventGenerator {
    constructor(emitter, selectors) {
        if (!selectors) {
            selectors = new Set();
        }
        this.emitter = emitter;
        this.parsedQueryMap = new Map();
        for (const selectorString of selectors) {
            this.parsedQueryMap.set(parseSelector(selectorString.replace(/:exit$/, "")), selectorString);
        }

        this.typeSpecificSelectorMap = new Map();
        this.generalSelectors = [];

        for (const selector of this.parsedQueryMap.keys()) {
            const typesToCheck = getNodeTypesHint(selector);

            if (typesToCheck) {
                typesToCheck.forEach(nodeType => {
                    if (!this.typeSpecificSelectorMap.has(nodeType)) {
                        this.typeSpecificSelectorMap.set(nodeType, []);
                    }
                    this.typeSpecificSelectorMap.get(nodeType).push(selector);
                });
            } else {
                this.generalSelectors.push(selector);
            }
        }

    }

    getSelectorsForNode(node, isExiting) {

        // TODO: Performance can be improved here
        return (this.typeSpecificSelectorMap.get(node.type) || [])
            .concat(this.generalSelectors)
            .filter(selector => this.parsedQueryMap.get(selector).endsWith(":exit") === isExiting);
    }

    /**
     * Emits an event of entering AST node.
     * @param {ASTNode} node - A node which was entered.
     * @returns {void}
     */
    enterNode(node) {
        this.getSelectorsForNode(node, false).forEach(parsedSelector => {
            if (checkMatch(parsedSelector, node)) {
                this.emitter.emit(this.parsedQueryMap.get(parsedSelector), node);
            }
        });
    }

    /**
     * Emits an event of leaving AST node.
     * @param {ASTNode} node - A node which was left.
     * @returns {void}
     */
    leaveNode(node) {

        // TODO: Cache the results from enterNode
        this.getSelectorsForNode(node, true).forEach(parsedSelector => {
            if (checkMatch(parsedSelector, node)) {
                this.emitter.emit(this.parsedQueryMap.get(parsedSelector), node);
            }
        });
    }
};
