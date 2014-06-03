var WorkflowRegistry = require("./workflowRegistry");
var _ = require("underscore-node");
var Activity = require("../activities/activity");
var Workflow = require("../activities/workflow");
var WorkflowPersistence = require("./workflowPersistence");
var WorkflowInstance = require("./workflowInstance");
var InstanceIdParser = require("./instanceIdParser");
var enums = require("../common/enums");
var specStrings = require("../common/specStrings");
var Q = require("q");
var asyncHelpers = require("./asyncHelpers");

function WorkflowHost()
{
    this._registry = new WorkflowRegistry();
    this._trackers = [];
    this._isInitialized = false;
    this.instanceIdParser = new InstanceIdParser();
    this._knownRunningInstances = {};
    this._options = _.extend(
        {
            enterLockTimeout: 1000
        },
        options);
}

Object.defineProperties(
    WorkflowHost.prototype, {
        isInitialized: {
            get: function ()
            {
                return this._isInitialized;
            }
        },

        persistence: {
            get: function ()
            {
                return this._persistence;
            },
            set: function (value)
            {
                if (this.isInitialized) throw new Error("Cannot set persistence after the host is initialized.");
                this._persistence = new WorkflowPersistence(value);
            }
        }
    });

WorkflowHost.prototype.registerWorkflow = function (workflow)
{
    this._registry.register(workflow);
}

WorkflowHost.prototype.registerActivity = function (activity, name, version)
{
    if (!(activity instanceof Activity)) throw new TypeError("Activity argument expected.");
    var wf = new Workflow();
    wf.name = name;
    wf.version = version;
    wf.args = [ activity ];
    this._registry.register(wf);
}

WorkflowHost.prototype._initialize = function()
{
    if (!this._isInitialized)
    {
        // Do init here ...
        this._isInitialized = true;
    }
}

WorkflowHost.prototype.invokeMethod = function (workflowName, methodName, args)
{
    if (!_(workflowName).isString()) throw new TypeError("Argument 'workflowName' is not a string.");
    workflowName = workflowName.trim();
    if (!_(methodName).isString()) throw new TypeError("Argument 'methodName' is not a string.");
    methodName = methodName.trim();

    var self = this;

    self._initialize();

    return self._getRunningInstanceIdPaths(workflowName, methodName).then(
        function(paths)
        {
            var runningInstanceId = null;
            if (paths)
            {
                paths.forEach(function(path)
                {
                    if (self.instanceIdParser.parse(path.value, args) == path.instanceId)
                    {
                        runningInstanceId = path.instanceId;
                        return false;
                    }
                });
            }
            if (runningInstanceId)
            {
                return self._invokeMethodOnRunningInstance(runningInstanceId, workflowName, methodName, args);
            }
            else
            {
                return self._createInstanceAndInvokeMethod(workflowName, methodName, args);
            }
        });
}

WorkflowHost.prototype._createInstanceAndInvokeMethod = function(workflowName, methodName, args)
{
    var self = this;
    
    var wfDesc = self._registry.getDesc(workflowName);
    if (!wfDesc.createInstanceMethods[methodName]) throw Error("Workflow '" + workflowName + "' cannot be created by invoking method '" + methodName + "'.");

    var createInsta = function(lockInfo)
    {
        var insta = new WorkflowInstance(self);
        return insta.create(wfDesc.workflow, methodName, args, lockInfo).then(
            function(result)
            {
                if (insta.execState === enums.ActivityStates.idle)
                {
                    if (self._persistence)
                    {
                        return self.persistence.persistState(insta).then(
                            function ()
                            {
                                self._knownRunningInstances[insta.id] = insta;
                                return result;
                            });
                    }
                    else
                    {
                        self._knownRunningInstances[insta.id] = insta;
                        return result;
                    }
                }
                else
                {
                    return result;
                }
            });
    }

    if (!this._persistence) return createInsta(null);

    var lockName = specStrings.hosting.createCWFLockName(workflowName);
    return this._persistence.enterLock(lockName, 1000, 1000).then(
        function(lockInfo)
        {
            return asyncHelpers.doInTime(createInsta(lockInfo), 1000);
        });
}

WorkflowHost.prototype._invokeMethodOnRunningInstance = function(runningInstanceId, workflowName, methodName, args)
{
    throw new Error("Not implemented.");
}

WorkflowHost.prototype._getRunningInstanceIdPaths = function (workflowName, methodName)
{
    if (this._persistence)
    {
        return this._persistence.getRunningInstanceIdPaths(workflowName, methodName);
    }
    else
    {
        var defer = Q.defer();
        try
        {
            var result = [];
            for (var n in this._knownRunningInstances)
            {
                var insta = this._knownRunningInstances[n];
                if (insta.workflowName === workflowName)
                {
                    insta.idleMethods.forEach(function(mi)
                    {
                        if (mi.methodName == methodName)
                            result.push(
                                {
                                    instanceId: insta.id,
                                    value: mi.instanceIdPath
                                });
                    });
                }
            }
            defer.resolve(result);
        }
        catch (e)
        {
            defer.reject(e);
        }
        return defer.promise;
    }
}

WorkflowHost.prototype.addTracker = function (tracker)
{
    if (!_(tracker).isObject()) throw new TypeError("Argument is not an object.");
    this._trackers.push(tracker);
    // TODO: add tracker to all instances
}

module.exports = WorkflowHost;