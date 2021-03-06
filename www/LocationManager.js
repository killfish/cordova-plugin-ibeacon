/*
 Licensed to the Apache Software Foundation (ASF) under one
 or more contributor license agreements.  See the NOTICE file
 distributed with this work for additional information
 regarding copyright ownership.  The ASF licenses this file
 to you under the Apache License, Version 2.0 (the
 "License"); you may not use this file except in compliance
 with the License.  You may obtain a copy of the License at
 
 http://www.apache.org/licenses/LICENSE-2.0
 
 Unless required by applicable law or agreed to in writing,
 software distributed under the License is distributed on an
 "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 KIND, either express or implied.  See the License for the
 specific language governing permissions and limitations
 under the License.
 */

var exec = require('cordova/exec');
var _ = require('org.apache.cordova.ibeacon.underscorejs');
var klass = require('org.apache.cordova.ibeacon.klass');
var Q = require('org.apache.cordova.ibeacon.Q');

var Regions = require('org.apache.cordova.ibeacon.Regions');
var Delegate = require('org.apache.cordova.ibeacon.Delegate');

var Region = require('org.apache.cordova.ibeacon.Region');
var CircularRegion = require('org.apache.cordova.ibeacon.CircularRegion');
var BeaconRegion = require('org.apache.cordova.ibeacon.BeaconRegion');

/**
 * Creates an instance of the plugin.
 * 
 * Important note: Creating multiple instances is expected to break the delegate
 * callback mechanism, as the native layer can only handle one  callback ID at a 
 * time.
 *
 * @constructor {LocationManager}
 */
var LocationManager = klass({
    delegate: null,
    initialize: function() {
        this.delegate = new Delegate();
        this.registerDelegateCallbackId();

        this.bindMethodContexts();
    },
    /**
     * Binds the contexts of instance methods to the actual {LocationManager}
     * instance. 
     * The goal of this is to make the caller code clean of binding calls when
     * the promise functions are chained for example.
     * 
     * @returns {undefined}
     */
    bindMethodContexts: function() {
        this.disableDebugLogs = _.bind(this.disableDebugLogs, this);
        this.enableDebugLogs = _.bind(this.enableDebugLogs, this);
    },
    getDelegate: function() {
        return this.delegate;
    },
    setDelegate: function(newDelegate) {
        this.delegate = newDelegate;
        return this.getDelegate();
    }
});

LocationManager.methods({
    /**
     * Calls the method 'registerDelegateCallbackId' in the native layer which
     * saves the callback ID for later use. 
     * 
     * The saved callback ID will be used when the native layer wants to notify
     * the DOM asynchronously about an event of it's own, for example entering 
     * into a region.
     * 
     * @returns {Q.Promise}
     */
    registerDelegateCallbackId: function() {
        this.appendToDeviceLog('registerDelegateCallbackId()');
        var d = Q.defer();

        exec(_.bind(this.onDelegateCallback, this, d), d.reject, "LocationManager",
                "registerDelegateCallbackId", []);

        return d.promise;
    },
    /**
     * Handles asynchronous calls from the native layer. In this context async
     * means that message is not a response to a request of the DOM.
     * 
     * @param {type} deferred : {promise, resolve, reject} object.
     * 
     * @param {type} pluginResult : The PluginResult object constructed by the
     * native layer as the payload of the message it wishes to send to the DOM
     * asynchronously.
     *  
     * @returns {undefined}
     */
    onDelegateCallback: function(deferred, pluginResult) {
        this.appendToDeviceLog('onDelegateCallback() ' + JSON.stringify(pluginResult));
        if (Q.isPending(deferred.promise)) {
            deferred.resolve();
        } else if (_.isString(pluginResult.eventType)) {
            this.mapDelegateCallback(pluginResult);
        } else {
            console.error('Delegate registration promise is already been resolved, all subsequent callbacks should provide an "eventType" field.');
        }
    },
    /**
     * Routes async messages arriving from the native layer to the appropriate
     * delegate methods.
     * 
     * @param {type} pluginResult The PluginResult object constructed by the
     * native layer as the payload of the message it wishes to send to the DOM
     * 
     * @returns {undefined}
     */
    mapDelegateCallback: function(pluginResult) {
        var eventType = pluginResult.eventType; // the Objective-C selector's name

        if (_.isFunction(Delegate[eventType])) {
            Delegate[eventType](pluginResult);
            this.delegate[eventType](pluginResult);
        } else {
            console.error('Delegate unable to handle eventType: ' + eventType);
        }
    },
    /**
     * Goes through the provided pre-processors *in order* adn applies them to 
     * [pluginResult].
     * When the pre-processing is done, [resolve] is called with the pre-
     * processed results. The raw input is discarded.
     * 
     * @param {type} resolve A callback which will get called upon completeion.
     *
     * @param {Array} pluginResult The PluginResult object constructed by the
     * native layer as the payload of the message it wishes to send to the DOM.
     * This function expects the [pluginResult] to be an array of elements.
     *
     * @param {type} preProcessors
     *
     * @returns {undefined}
     */
    preProcessorExecutor: function(resolve, pluginResult, preProcessors) {
        _.each(preProcessors, function(preProcessor, index, list) {
            pluginResult = preProcessor(pluginResult);
        });
        resolve(pluginResult);
    },
    /**
     * Wraps a Cordova exec call into a promise, allowing the client code to
     * operate with those promises instead of callbacks.
     * 
     * @param {String} method : The name of the method in the native layer to be
     * called by Cordova.
     * 
     * @param {Array} commandArgs : An array of arguments to be passed for the
     * native layer. Defaults to an empty array if omitted.
     * 
     * @param {Array} preProcessors : An array of callback functions all of which 
     * takes an iterable (array) as it's parameter and applies a certain 
     * operation to the elements of that iterable.
     * 
     * @returns {Q.Promise}
     */
    promisedExec: function(method, commandArgs, preProcessors) {
        var self = this;
        commandArgs = _.isArray(commandArgs) ? commandArgs : [];
        preProcessors = _.isArray(preProcessors) ? preProcessors : [];
        preProcessors = _.filter(preProcessors, function(preProcessor) {
            return _.isFunction(preProcessor);
        });

        var d = Q.defer();


        var resolveWrap = function(pluginResult) {
            self.preProcessorExecutor(d.resolve, pluginResult, preProcessors);
        };

        exec(resolveWrap, d.reject, "LocationManager", method, commandArgs);

        return d.promise;
    },
    /**
     * Start monitoring the specified region.
     *
     * If a region of the same type with the same identifier is already being 
     * monitored for this application,
     * it will be removed from monitoring. For circular regions, the region 
     * monitoring service will prioritize
     * regions by their size, favoring smaller regions over larger regions.
     *
     * This is done asynchronously and may not be immediately reflected in monitoredRegions.
     * 
     * @param {Region} region : An instance of {Region} which will be monitored
     * by the operating system.
     * 
     * @return {Q.Promise} Returns a promise which is resolved as soon as the
     * native layer acknowledged the dispatch of the monitoring request.
     */
    startMonitoringForRegion: function(region) {
        Regions.checkRegionType(region);

        var d = Q.defer();
        exec(d.resolve, d.reject, "LocationManager", "startMonitoringForRegion", [region]);
        return d.promise;
    },
    /**
     * Stop monitoring the specified region.  It is valid to call 
     * stopMonitoringForRegion: for a region that was registered for monitoring 
     * with a different location manager object, during this or previous 
     * launches of your application.
     *
     * This is done asynchronously and may not be immediately reflected in monitoredRegions.
     * 
     * @param {Region} region : An instance of {Region} which will be monitored
     * by the operating system.
     * 
     * @return {Q.Promise} Returns a promise which is resolved as soon as the
     * native layer acknowledged the dispatch of the request to stop monitoring.
     */
    stopMonitoringForRegion: function(region) {
        Regions.checkRegionType(region);
        return this.promisedExec('stopMonitoringForRegion', [region]);
    },
    /**
     * Queries the native layer to determine the current authorization in effect.
     * 
     * @returns {Q.Promise} Returns a promise which is resolved with the 
     * requested authorization status.
     */
    getAuthorizationStatus: function() {
        return this.promisedExec('getAuthorizationStatus');
    },
    /** 
     * 
     * @returns {Q.Promise} Returns a promise which is resolved with an {Array}
     * of {Region} instances that are being monitored by the native layer.
     */
    getMonitoredRegions: function() {
        var preProcessors = [Regions.fromJsonArray];
        return this.promisedExec('getMonitoredRegions', [], preProcessors);
    },
    /** 
     * 
     * @returns {Q.Promise} Returns a promise which is resolved with an {Array}
     * of {Region} instances that are being ranged by the native layer.
     */
    getRangedRegions: function() {
        var preProcessors = [Regions.fromJsonArray];
        return this.promisedExec('getRangedRegions', [], preProcessors);
    },
    /**
     * Determines if ranging is available or not, according to the native layer.
     * @returns {Q.Promise} Returns a promise which is resolved with a {Boolean}
     * indicating wether ranging is available or not.
     */
    isRangingAvailable: function() {
        return this.promisedExec('isRangingAvailable');
    },
    /**
     * Disables debug logging in the native layer. Use this method if you want
     * to prevent this plugin from writing to the device logs.
     * 
     * @returns {Q.Promise} Returns a promise which is resolved as soon as the
     * native layer has set the logging level accordingly.
     */
    disableDebugLogs: function() {
        return this.promisedExec('disableDebugLogs');
    },
    /**
     * Enables debug logging in the native layer. Use this method if you want
     * a debug the inner workings of this plugin.
     * 
     * @returns {Q.Promise} Returns a promise which is resolved as soon as the
     * native layer has set the logging level accordingly.
     */
    enableDebugLogs: function() {
        return this.promisedExec('enableDebugLogs');
    },
    /**
     * Appends the provided [message] to the device logs.
     * Note: If debug logging is turned off, this won't do anything.
     * 
     * @param {String} message : The message to append to the device logs.
     * 
     * @returns {Q.Promise} Returns a promise which is resolved with the log
     * message received by the native layer for appending. The returned message
     * is expected to be equivalent to the one provided in the original call.
     */
    appendToDeviceLog: function(message) {
        return this.promisedExec('appendToDeviceLog', [message]);
    }
});


var locationManager = new LocationManager();
locationManager.Regions = Regions;
locationManager.Region = Region;
locationManager.CircularRegion = CircularRegion;
locationManager.BeaconRegion = BeaconRegion;
locationManager.Delegate = Delegate;

module.exports.LocationManager = LocationManager;
module.exports.locationManager = locationManager;
