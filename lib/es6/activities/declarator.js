"use strict";

let Activity = require("./activity");
let util = require("util");
let StrSet = require("backpack-node").collections.StrSet;
let is = require("../common/is");

function Declarator() {
    Activity.call(this);
    this.nonScopedProperties.add("reservedProperties");
    this.nonScopedProperties.add("reserved");
    this.nonScopedProperties.add("promotedProperties");
    this.nonScopedProperties.add("promoted");
    this.nonScopedProperties.add("varsDeclared");

    // Properties those cannot be declared freely
    this.reservedProperties = new StrSet();

    // Properties those will be promoted during serialization
    this.promotedProperties = new StrSet();
}

util.inherits(Declarator, Activity);

Declarator.prototype.reserved = function (name, value) {
    if (this.promotedProperties.exists(name)) {
        throw new Error("Property '" + name + "' cannot be reserved because it's promoted.");
    }
    if (is.defined(value)) {
        this[name] = value;
    }
    this.reservedProperties.add(name);
};

Activity.prototype.promoted = function (name, value) {
    if (this.reservedProperties.exists(name)) {
        throw new Error("Property '" + name + "' cannot be promoted because it's reserved.");
    }
    if (is.defined(value)) {
        this[name] = value;
    }
    this.promotedProperties.add(name);
};

Declarator.prototype.run = function (callContext, args) {
    let self = this;
    let activityVariables = [];
    let _activityVariableFieldNames = [];
    self.set("_activityVariableFieldNames", _activityVariableFieldNames);
    let resProps = callContext.activity.reservedProperties;
    for (let fieldName of callContext.activity._getScopeKeys()) {
        if (!resProps.exists(fieldName)) {
            let fieldValue = self.get(fieldName);
            if (fieldValue instanceof Activity) {
                activityVariables.push(fieldValue);
                _activityVariableFieldNames.push(fieldName);
            }
        }
    }

    if (activityVariables.length) {
        self.set("_savedArgs", args);
        callContext.schedule(activityVariables, "_varsGot");
    }
    else {
        self.delete("_activityVariableFieldNames");
        callContext.activity.varsDeclared.call(self, callContext, args);
    }
};

Declarator.prototype._varsGot = function (callContext, reason, result) {
    let self = this;
    if (reason === Activity.states.complete) {
        let idx = 0;
        for (let fieldName of self.get("_activityVariableFieldNames")) {
            self.set(fieldName, result[idx++]);
        }
        let args = self.get("_savedArgs");
        self.delete("_savedArgs");
        self.delete("_activityVariableFieldNames");
        callContext.activity.varsDeclared.call(self, callContext, args);
    }
    else {
        callContext.end(reason, result);
    }
};

module.exports = Declarator;