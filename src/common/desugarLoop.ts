/**
 * Module to desugar all loops to while loops. This requires
 * the following transformations to be done:
 *
 * This plugin must enforce the following assumption about loops:
 *
 * Loop bodies are BlockStatements:
 * Loops can have an ExpressionStatement for their body. This messes
 * up the anf pass since it tries to added the complex named expression
 * to the nearest statement. In this case, the statement will be
 * outside the body of the for loop, effectively hoisting them outside
 * the function body. To fix this, the body of all loops should a statement.
 * 
 * Postconditions:
 *  
 *   1. The program only has while loops.
 */

import {NodePath, VisitNode, Visitor} from 'babel-traverse';
import * as t from 'babel-types';
import * as h from '../common/helpers';
import * as fastFreshId from '../fastFreshId';
import * as bh from '../babelHelpers';

// Object containing the visitor functions
const loopVisitor : Visitor = {
  ForInStatement: function (path: NodePath<t.ForInStatement>): void {
    const { left, right, body } = path.node;
    const it_obj = fastFreshId.fresh('it_obj');
    const keys = fastFreshId.fresh('keys');
    const idx = fastFreshId.fresh('idx');
    const prop = t.isVariableDeclaration(left) ?
    t.variableDeclaration(left.kind, [
      t.variableDeclarator(left.declarations[0].id, t.memberExpression(keys, idx, true))
    ]) :
    t.expressionStatement(t.assignmentExpression('=', left, t.memberExpression(keys, idx, true)));

    path.insertBefore(h.letExpression(it_obj, right));
    const newBody = h.flatBodyStatement([
      h.letExpression(keys, t.callExpression(t.memberExpression(t.identifier('Object'),
        t.identifier('keys')), [it_obj]), 'const'),
      t.forStatement(h.letExpression(idx, t.numericLiteral(0)),
        t.binaryExpression('<', idx, t.memberExpression(keys, t.identifier('length'))),
        t.updateExpression('++', idx),
        h.flatBodyStatement([prop, body])),
      t.expressionStatement(t.assignmentExpression('=', it_obj,
        t.callExpression(t.memberExpression(t.identifier('Object'),
          t.identifier('getPrototypeOf')), [it_obj])))
    ]);
    path.replaceWith(t.whileStatement(t.binaryExpression('!==', it_obj, t.nullLiteral()),
      newBody));
  },
  // Convert For Statements into While Statements
  ForStatement: function ForStatement(path: NodePath<t.ForStatement>): void {
    const node = path.node;
    let { init, test, update, body: wBody } = node;
    let nupdate : t.Statement|t.Expression = update;

    // New body is a the old body with the update appended to the end.
    if (nupdate === null) {
      nupdate = t.emptyStatement();
    } else {
      nupdate = t.expressionStatement(update);
    }
    const loopContinue = fastFreshId.fresh('loop_continue');
    wBody = t.blockStatement([
      t.labeledStatement(loopContinue, wBody),
      nupdate,
    ]);

    // Test can be null
    if (test === null) {
      test = t.booleanLiteral(true);
    }

    const wl = h.continueLbl(t.whileStatement(test, wBody), loopContinue);

    // The init can either be a variable declaration or an expression
    let nInit : t.Statement = t.emptyStatement();
    if (init !== null) {
      nInit = t.isExpression(init) ? t.expressionStatement(init) : init;
    }

    bh.replaceWithStatements(path, nInit, wl);
  },

  // Convert do-while statements into while statements.
  DoWhileStatement: function DoWhileStatement(path: NodePath<t.DoWhileStatement>): void {
    const node = path.node;
    let { test, body } = node;

    // Add flag to run the while loop at least once
    const runOnce = fastFreshId.fresh('runOnce');
    const runOnceInit = t.variableDeclaration('let',
      [t.variableDeclarator(runOnce, t.booleanLiteral(true))]);
    const runOnceSetFalse =
    t.expressionStatement(
      t.assignmentExpression('=', runOnce, t.booleanLiteral(false)));
    body = h.flatBodyStatement([runOnceSetFalse, body]);

    test = t.logicalExpression('||', runOnce, test);

    bh.replaceWithStatements(path,runOnceInit, t.whileStatement(test, body));
  },

  WhileStatement: function (path: NodePath<h.While<h.Break<t.WhileStatement>>>): void {
    // Wrap the body in a labeled continue block.
    if (path.node.continue_label === undefined) {
      const loopContinue = fastFreshId.fresh('loop_continue');
      path.node = h.continueLbl(path.node, loopContinue);
      path.node.body = t.labeledStatement(loopContinue, path.node.body);
    }

    // Wrap the loop in labeled break block.
    if (path.node.break_label === undefined) {
      const loopBreak = fastFreshId.fresh('loop_break');
      path.node = h.breakLbl(path.node, loopBreak);
      const labeledStatement = t.labeledStatement(loopBreak, path.node);
      path.replaceWith(labeledStatement);
    }
  }
}

module.exports = function() {
  return { visitor: loopVisitor };
};
