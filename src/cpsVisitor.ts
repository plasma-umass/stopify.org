/**
 * Plugin to transform JS programs into CPS form.
 */

import * as t from 'babel-types';

// Hack to avoid applying visitors to newly constructed nodes.
function isCPS(node) {
    return node.cps;
}

function createTailFunction(tailPath, tail, headK, tailK) {
    const newTail = foldSequence(tailPath, tail);
    const tailCall = t.callExpression(newTail, [headK]);
    tailCall.cps = true;
    const tailReturn = t.returnStatement(tailCall);
    tailReturn.cps = true;
    const tailBody = t.blockStatement([tailReturn]);
    tailBody.cps = true;
    const tailFunction = t.functionExpression(null, [tailK], tailBody);
    tailFunction.cps = true;
    return tailFunction;
}

function createHeadFunction(head, headK, ...headCallArgs) {
    const headCall = t.callExpression(head, [...headCallArgs]);
    headCall.cps = true;
    const headReturn = t.returnStatement(headCall);
    headReturn.cps = true;
    const headBody = t.blockStatement([headReturn]);
    headBody.cps = true;
    const headFunction = t.functionExpression(null, [headK], headBody);
    headFunction.cps = true;
    return headFunction;
}

function foldSequence(path, statements) {
    let tailPath = path.getSibling(1);
    const [head, ...tail] = statements;
    const headK = path.scope.generateUidIdentifier('k');
    const tailK = path.scope.generateUidIdentifier('k');
    if (head === undefined) {
        const k = path.scope.generateUidIdentifier('k');
        const kCall = t.callExpression(k, [t.unaryExpression('void', t.numericLiteral(0))]);
        kCall.cps = true;
        const kReturn = t.returnStatement(kCall);
        kReturn.cps = true;
        const kBody = t.blockStatement([kReturn]);
        kBody.cps = true;
        const kFunction = t.functionExpression(null, [k], kBody);
        kFunction.cps = true;
        return kFunction;
    } else {
        switch (head.type) {
            case 'ExpressionStatement': {
                tailPath = tailPath.scope === null ? path : tailPath;
                const tailFunction = createTailFunction(tailPath, tail, headK, tailK);
                const headFunction = createHeadFunction(head.expression, headK, tailFunction);
                return headFunction;
            } case 'VariableDeclaration': {
                const { declarations } = head;
                const { id, init } = declarations[0];
                if (t.isCallExpression(init)) {
                    const tailFunction = createTailFunction(tailPath, tail, headK, id);
                    const headFunction = createHeadFunction(init.callee, headK, tailFunction, ...init.arguments);
                    return headFunction;
                } else {
                    const k = path.scope.generateUidIdentifier('k');
                    const kCall = t.callExpression(k, [id]);
                    kCall.cps = true;
                    const kReturn = t.returnStatement(kCall);
                    kReturn.cps = true;
                    const kBody = t.blockStatement([head, kReturn]);
                    kBody.cps = true;
                    const expFunction = t.functionExpression(null, [k], kBody);
                    expFunction.cps = true;

                    const tailFunction = createTailFunction(tailPath, tail, headK, id);
                    const headFunction = createHeadFunction(expFunction, headK, tailFunction);
                    return headFunction;
                }
            } case 'FunctionDeclaration': {
                const k = path.scope.generateUidIdentifier('k');
                const kCall = t.callExpression(k, [head.id]);
                kCall.cps = true;
                const kReturn = t.returnStatement(kCall);
                kReturn.cps = true;
                const kBody = t.blockStatement([head, kReturn]);
                kBody.cps = true;
                const expFunction = t.functionExpression(null, [k], kBody);
                expFunction.cps = true;

                const tailFunction = createTailFunction(tailPath, tail, headK, head.id);
                const headFunction = createHeadFunction(expFunction, headK, tailFunction);
                return headFunction;
            } default: {
                tailPath = tailPath.scope === null ? path : tailPath;
                const tailFunction = createTailFunction(tailPath, tail, headK, tailK);

                const k = path.scope.generateUidIdentifier('k');
                const kCall = t.callExpression(k, [t.unaryExpression('void', t.numericLiteral(0))]);
                kCall.cps = true;
                const kReturn = t.returnStatement(kCall);
                kReturn.cps = true;
                const kBody = t.blockStatement([path.node, kReturn]);
                kBody.cps = true;
                const expFunction = t.functionExpression(null, [k], kBody);
                expFunction.cps = true;

                return expFunction;
            }
        }
    }
}

const cpsVisitor = {
    Program: {
        exit(path) {
            const { body } = path.node;
            const bodyPath = path.get('body.0');
            const newBody = t.expressionStatement(foldSequence(bodyPath, body));
            newBody.cps = true;
            path.node.body = [newBody];
        },
    },

    // Block Statements are visited on exit so that their body is CPS'd.
    //
    // Transformation:
    // CPS [[ [s1; ... ; s2] ]] =>
    //   [[ [`foldSequence(p, [s1;...;s2])`] ]]
    //
    // Assumptions:
    //  - `foldSequence` properly chains together continuations generated by
    //    variable declarations and applications.
    BlockStatement: {
        exit(path) {
            if (isCPS(path.node)) return;
            const { body } = path.node;

            const bodyPath = path.get('body.0');
            const newBody = foldSequence(bodyPath, body);

            const newBlock = t.blockStatement([t.expressionStatement(newBody)]);
            newBlock.cps = true;
            path.node.body = [t.expressionStatement(newBody)];
        },
    },

    // Return Statements
    //
    // Transformation:
    // CPS [[ return e; ]] =>
    //   let k = return continuation;
    //   [[ function (k') {
    //        return k(e);
    //      } ]]
    //
    // Assumptions:
    //  - A prior pass has tagged all return statements with the continuation
    //    argument of the appropriate function.
    ReturnStatement: function (path) {
        if (isCPS(path.node)) return;

        const k = path.scope.generateUidIdentifier('k');
        const returnCall = t.callExpression(path.node.kArg, [path.node.argument]);
        returnCall.cps = true;
        const newReturn = t.returnStatement(returnCall);
        newReturn.cps = true;
        const returnBody = t.blockStatement([newReturn]);
        returnBody.cps = true;
        const returnFunction = t.functionExpression(null, [k], returnBody);
        returnFunction.cps = true;
        const fExp = t.expressionStatement(returnFunction);
        fExp.cps = true;

        path.replaceWith(fExp);
    },


    // Definitely-Terminating Expression Statements
    //
    // Transformation:
    // CPS [[ m ]] =>
    //   [[ function (k) {
    //        m;
    //        return k(null);
    //      } ]]
    //
    // Assumptions:
    //  - Expression Statements don't return any value, so they are run and
    //    sequentially followed by the continuation applied to `null`.
    ExpressionStatement: function (path) {
        if (isCPS(path.node)) return;
        if (t.isFunctionExpression(path.node.expression)) return;

        path.node.cps = true;
        const k = path.scope.generateUidIdentifier('k');
        const kCall = t.callExpression(k, [t.unaryExpression('void', t.numericLiteral(0))]);
        kCall.cps = true;
        const kReturn = t.returnStatement(kCall);
        kReturn.cps = true;
        const kBody = t.blockStatement([path.node, kReturn]);
        kBody.cps = true;
        const expFunction = t.functionExpression(null, [k], kBody);
        expFunction.cps = true;
        const newExp = t.expressionStatement(expFunction);
        newExp.cps = true;

        path.replaceWith(newExp);
    },

    // If Statements are visited on exit so that branches have been CPS'd.
    //
    // Transformation:
    // CPS [[ if (t) { s1 } else { s2 } ]] =>
    //   [[ function (k) {
    //        if (t) {
    //          return `CPS [[ s1 ]]`(k);
    //        } else {
    //          return `CPS [[ s2 ]]`(k);
    //        }
    //      } ]]
    //
    // Assumptions:
    //  - Branch block statements consist of a single function expression statement
    IfStatement: {
        exit(path) {
            if (isCPS(path.node)) return;
            const { test, consequent, alternate } = path.node;

            path.node.cps = true;
            const k = path.scope.generateUidIdentifier('k');
            const trueCall = t.callExpression(consequent.body[0].expression, [k]);
            trueCall.cps = true;
            const trueReturn = t.returnStatement(trueCall);
            trueReturn.cps = true;
            path.node.consequent = trueReturn;
            if (alternate !== null) {
                const falseCall = t.callExpression(alternate.body[0].expression, [k]);
                falseCall.cps = true;
                const falseReturn = t.returnStatement(falseCall);
                falseReturn.cps = true;
                path.node.alternate = falseReturn;
            }

            const ifBody = t.blockStatement([path.node]);
            ifBody.cps = true;
            const ifFunction = t.functionExpression(null, [k], ifBody);
            ifFunction.cps = true;

            path.replaceWith(ifFunction);
        },
    },

    // Functions are visited on exit, so that bodies have been CPS'd.
    //
    // Transformation:
    // CPS [[ function (...args) { s } ]] =>
    //   [[ function (k, ...args) {
    //        return `CPS [[ s ]]`(k);
    //      } ]]
    //
    // Assumptions:
    //  - `s` has been visited and is a block statement containing a single
    //    function expression.
    Function: {
        exit(path) {
            if (isCPS(path.node)) return;
            const { params, body } = path.node;

            if (t.isReturnStatement(body.body[0])) return;
            const bodyFunc = body.body[0].expression;
            const bodyCall = t.callExpression(bodyFunc, [params[0]]);
            bodyCall.cps = true;
            const bodyReturn = t.returnStatement(bodyCall);
            bodyReturn.cps = true;
            const bodyBlock = t.blockStatement([bodyReturn]);
            bodyBlock.cps = true;
            path.node.body = bodyBlock;
        },
    }
}

module.exports = function (babel) {
    return { visitor: cpsVisitor };
};
