/**
 * Module to desugar labeled statements into try catches.
 *
 * A label statement turns into a try catch block that catches a
 * corresponding named block on a break.
 *
 * TODO Figure out what should happen on a continue.
 */

const t = require('babel-types');
const g = require('babel-generator');

// Object containing the visitor functions
const visitor = {};

visitor.BreakStatement = function (path) {
  const label = path.node.label;
  if (label === null) {
    const labeledParent =
      path.findParent(p => p.isWhileStatement() || p.isSwitchStatement());
    const labelParent = labeledParent.findParent(p => p.isLabeledStatement());

    if (labelParent === null) {
      throw new Error(
        `Parent of ${labelParent.type} wasn't a labeledStatement`);
    }
    path.node.label = labelParent.node.label;
  }
};

visitor.WhileStatement = function (path) {
  if (t.isLabeledStatement(path.parent)) return;

  const loopName = path.scope.generateUidIdentifier('loop');
  const labeledStatement = t.labeledStatement(loopName, path.node);
  path.replaceWith(labeledStatement)
}

visitor.SwitchStatement = function (path) {
  if (t.isLabeledStatement(path.parent)) return;

  const loopName = path.scope.generateUidIdentifier('switch');
  const labeledStatement = t.labeledStatement(loopName, path.node);
  path.replaceWith(labeledStatement)
}

/* visitor.LabeledStatement = function LabeledStatement(path) {
  const node = path.node;
  const labelName = t.stringLiteral(`${node.label.name}-label`);
  const body = node.body;

  const catchHandler = t.catchClause(t.identifier('e'),
      t.blockStatement([
        t.ifStatement(
          t.binaryExpression('!==', t.identifier('e'), labelName),
          t.throwStatement(t.identifier('e')),
          null)]));

  const tryCatchClause = t.tryStatement(body, catchHandler);
  path.replaceWith(tryCatchClause);
};*/


module.exports = function transform(babel) {
  return { visitor };
};
