
(function() {
  "use strict";

var log = function() {
  var msg = '';
  for (var i = 0; i < arguments.length; i++) {
    var val = arguments[i];
    msg += (typeof val === 'string') ? val : JSON.stringify(val, undefined, 2);
  }

  console.log(msg);
};

var kh = {

  baseUrl: "https://konsoleh.your-server.de",
  jqueryUrl: 'https://ajax.googleapis.com/ajax/libs/jquery/1.8.3/jquery.min.js',

  /* Gets overridden by parseSystemArgs() */
  settings: {
    username: '',
    password: '',

    cmd: '',
    params: []
  },

  urlHistory: [],

  page: null,

  nextCallback: null,
  lastCallbackUrl: null,

  pageJobQueue: [],

  data: {},

  init: function() {
    var that = this;

    this.parseSystemArgs();
    log('Initializing with settings: ', this.settings);

    this.page = require('webpage').create();
    this.page.onConsoleMessage = function () {
      log.apply(window, arguments);
    };
    this.page.onLoadFinished = function(status) {
      that.onLoadFinished(status);
    };
    this.page.onCallback = function(data) {
      that.onPageCallback(data);
    };

    this.load('', 'login');
  },

  parseSystemArgs: function() {
    var system = require('system');
    var args = system.args;
    log(args);

    args = ['', 'get_data',  '--user', 'C0702608709', '--password', 'A8AN4Q7T'];

    var parsed = {
      cmd: null,
      params: []
    };
    for (var i = 1; i < args.length; i++) {
      var val = args[i];

      if (val.substr(0, 2) === '--') {
        parsed[val.substr(2)] = args[++i];
      }
      else if (!parsed.cmd) {
        parsed.cmd = val;
      }
      else {
        parsed.params.push(val);
      }
    }

    if (!(parsed.cmd)) {
      log('No command specified.');
      phantom.exit();
      return;
    }

    var required = ['user', 'password'];

    for (var key in required) {
      if (!(required[key] in parsed)) {
        log('Missing required parameter ', required[key]);
        phantom.exit();
        return;
      }
    }
    this.settings = parsed;
  },

  load: function(url, callback) {
    var that = this;
    this.urlHistory.push(url);
    this.page.open(this.baseUrl + '/' + url, function(status) {
      that.onLoadFinished(status, url, callback);
    });
  },

  onLoadFinished: function(status, targetUrl, callback) {
    var that = this;
    if (status !== 'success') {
      log('Could not load ', this.request.url);
    }
    else {
      this.page.includeJs(that.jqueryUrl, function() {

        var url = that.currentUrl();
        // Prevent double-calling of callback.
        if (that.lastCallbackUrl === url) {
          return;
        }
        that.lastCallbackUrl = url;

        if (that.nextCallback) {
          callback = that.nextCallback;
          that.nextCallback = null;
        }

        if (!callback) {
          switch (url) {
            case 'frameset_home.php':
              callback = 'onLogin';
              break;
            default:
              break;
          }
        }

        log('Loaded ', url);

        if (callback && (callback in that)) {
          //log('Calling callback ', callback);
          that[callback]();
          callback = null;
        }
        else {
          log("Could not determine callback");
        }
      });
    }
  },

  onPageCallback: function(data) {
    log('onPageCallback: ', data);
    if ('callback' in data) {
      this[data.callback](data);
    }
  },

  currentUrl: function() {
    var url = this.page.url;
    url = url.replace(this.baseUrl + '/', '');

    return url;
  },

  /*
   * LOGIN functionality.
   */

  login: function() {
    log('Logging in with ', this.settings.user, '//', this.settings.password);

    this.nextCallback = 'onLogin';
    this.page.evaluate(function(user, password) {
      $('#login_user_inputbox').attr('value', user);
      $('#login_pass_inputbox').attr('value', password);
      $('input[type=submit]').click();
    }, this.settings.user, this.settings.password);
  },

  onLogin: function() {
    if (this.currentUrl() === 'login.php') {
      log('Could not login. Check credentials');
      phantom.exit();
      return;
    }
    else {
      // Inject jquery in page.
      var that = this;

      if (!this.page.injectJs('./punycode.js')) {
        log('Could not inject punycode.js');
        phantom.exit();
        return;
      }

      that.page.evaluate(function() {
        window.khClient = {
          leftFrame: null,
          mainFrame: null,

          pageRequests: {
            left: null,
            main: null
          },

          init: function() {
            this.leftFrame = document.getElementsByName('leftFrame')[0];
            this.mainFrame = document.getElementsByName('mainFrame')[0];

            this.ensureJquery(function() {
              callPhantom({
                callback: 'onPageInitialized'
              });
            });
          },

          ensureJquery: function(callback) {
            var script = '<script src="' + this.jqueryUrl + '" type="text/javascript"></script>';

            if (!('jQuery' in this.leftFrame.contentWindow)) {
              this.leftFrame.contentDocument.head.innerHTML += script;
            }
            if (!('jQuery' in this.mainFrame.contentWindow)) {
              this.mainFrame.contentDocument.head.innerHTML += script;
            }

            this.onJqueryWait(callback);
          },

          onJqueryWait: function(callback) {
            var left = 'jQuery' in this.leftFrame.contentWindow;
            var main = 'jQuery' in this.mainFrame.contentWindow;

            if (!(left && main)) {
              var that = this;
              setTimeout(function() {
                that.onJqueryWait(callback);
              });
            }
            else {
              callback();
            }
          },

          openInFrame: function(frame, url, callback, callbackData) {
            if (!callbackData || typeof callbackData !== 'object') {
              callbackData = {};
            }
            console.log(callbackData.callback);
            callbackData.callback = callback;

            var that = this;
            $(frame).unbind('load').load(function() {
              that.ensureJquery(function() {
                callPhantom(callbackData);
              });
            });
            frame.contentWindow.location = url;
          },

          openInLeftAndMain: function(urlLeft, urlMain, callback, callbackData) {
            if (typeof callbackData !== 'object') {
              callbackData = {};
            }
            callbackData.callback = callback;

            var that = this;
            $(this.leftFrame).unbind('load').load(function() {
              console.log('Loaded LEFT');
              $(that.mainFrame).unbind('load').load(function() {
                console.log('Loaded MAIN');
                that.ensureJquery(function() {
                  callPhantom(callbackData);
                });
              });
              that.mainFrame.contentWindow.location = urlMain;
            });
            this.leftFrame.contentWindow.location = urlLeft;
          },

          openInLeft: function(url, callback, callbackData) {
            this.openInFrame(this.leftFrame, url, callback, callbackData);
          },

          openInMain: function(url, callback, callbackData) {
            console.log('OPENING IN MAIN');
            this.openInFrame(this.mainFrame, url, callback, callbackData);
          }
        };
        khClient.init();
      });
    }
  },

  onPageInitialized: function() {
    this.runCmd(this.settings.cmd, this.settings.params);
  },

  runCmd: function(cmd, params) {
    this[cmd].apply(this, params);
  },

  frameEval: function() {

  },

  runOnPage: function(leftFrame, mainFrame, callback, callbackData) {
    this.page.evaluate(function(leftFrame, mainFrame, callback, callbackData) {
      if (leftFrame && mainFrame) {
        khClient.openInLeftAndMain(leftFrame, mainFrame, callback, callbackData);
      }
      else if (leftFrame) {
        khClient.openInLeft(leftFrame, callback, callbackData);
      }
      else if (mainFrame) {
        khClient.openInMain(mainFrame, callback, callbackData);
      }
    }, leftFrame, mainFrame, callback, callbackData);
  },

  processJobQueue: function() {
    if (this.pageJobQueue.length > 0) {
      var job = this.pageJobQueue.shift();

      this.runOnPage(job.leftFrame, job.mainFrame, job.callback, job.callbackData);
    }
  },

  addJob: function(leftFrame, mainFrame, callback, callbackData) {
    this.pageJobQueue.push({
      leftFrame: leftFrame,
      mainFrame: mainFrame,
      callback: callback,
      callbackData: callbackData
    });
  },

  /**
   * --------------- COMMAND FUNCTIONS ---------------
   */

  get_data: function() {
    log('Getting data');

    // First, the domains
    this.runOnPage(null, '/frame_center.php', 'getDomainList', null);
  },

  getDomainList: function() {
    this.data.domains = this.page.evaluate(function() {
      var jq = window.khClient.mainFrame.contentWindow.jQuery;

      var domains = {};
      var parent = null;

      jq('#ui-accordion-domainlist-panel-0 dt').each(function(index, item) {
        var $item = jq(item);

        // Skip deleted.
        if ($item.hasClass('deleted')) {
          return;
        }

        var name = $item.find('a').attr('name');
        if (!name) {
          console.log('Could not parse: ', $item.html());
          return;
        }

        name = punycode.toASCII(name);
        var isDedicated = $item.next().html().search('Addon Domain') === -1;

        var domain = {
          path: $item.find('a').attr('onclick')
            .replace("parent.leftFrame.location='", '')
            .replace(";return false;", '')
        };

        if (isDedicated) {
          parent = name;
          domain.type = $item.next().children().first().html();
          domain.subdomains = {};
          domains[name] = domain;
        }
        else {
          domain.type = 'Addon Domain';
          domains[parent].subdomains[name] = domain;
        }
      });

      return domains;
    });

    log('Got domain data: ');

    for (var name in this.data.domains) {
      var domain = this.data.domains[name];
      this.addJob(domain.path, '/ftp.php?', 'getDomainData', {domain: name});
    }

    this.processJobQueue();
  },

  getDomainData: function(data) {
    var domain = this.data.domains[data.domain];
    log('Getting data for domain: ', domain);
  }
};

kh.init();

}());
