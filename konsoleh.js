
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

  /* Gets overridden by parseSystemArgs() */
  settings: {
    username: '',
    password: '',

    cmd: '',
    params: []
  },

  page: null,

  data: {},

  lastCallbackUrl: null,
  nextCallback: null,

  jobQueue: [],

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

  addJob: function(url, callback, callbackParams, tag, prepend) {
    var job = {
      url: url,
      callback: callback,
      callbackParams: callbackParams,
      tag: tag
    };

    if (prepend) {
      this.jobQueue.unshift(job);
    }
    else {
      this.jobQueue.push(job);
    }
  },

  processJobQueue: function(tag) {
    var job = null;

    if (this.jobQueue.length > 0) {
      if (tag) {
        for (var key in this.jobQueue) {
          if (this.jobQueue[key].tag === tag) {
            job = this.jobQueue.splice(key, 1)[0];
            break;
          }
        }
      }
      else {
        job = this.jobQueue.shift();
      }

      if (job) {
        this.load(job.url, job.callback, job.callbackParams);
      }
    }

    return job;
  },

  load: function(url, callback, callbackParams) {
    var that = this;
    this.page.open(this.baseUrl + '/' + url, function(status) {
      that.onLoadFinished(status, url, callback, callbackParams);
    });
  },

  onLoadFinished: function(status, targetUrl, callback, callbackParams) {
    var that = this;
    if (status !== 'success') {
      log('Could not load ', this.request.url);
    }
    else {
      this.page.injectJs('jquery.js');

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

      log('Loaded ', url);

      if (callback) {
        if (!callbackParams) {
          callbackParams = [];
        }
        if (typeof callback === 'string' && (callback in that)) {
          that[callback].apply(that, callbackParams);
          callback = null;
        }
        else if (typeof callback === 'function') {
          callback.apply(that, callbackParams);
        }
        else {
          log('Unknown callback format: ', callback);
        }
      }
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
      this.page.injectJs('./punycode.js');
      this.runCmd();
    }
  },

  runCmd: function(cmd, params) {
    if (!cmd) {
      cmd = this.settings.cmd;
    }
    if (!params) {
      params = this.settings.params;
    }
    this[cmd].apply(this, params);
  },

  /**
   * --------------- COMMAND FUNCTIONS ---------------
   */

  get_data: function() {
    log('Getting all data');

    this.load('frame_center.php', 'getDomainList');
  },

  /**
   * --------------- END COMMAND FUNCTIONS ---------------
   */

  on_get_data: function() {
    log('Finished getting data.');
    this.saveData();
    phantom.exit();
  },

  getDomainList: function() {
    this.page.injectJs('punycode.js');

    this.data.domains = this.page.evaluate(function() {
      var domains = {};
      var parent = null;

      $('#ui-accordion-domainlist-panel-0 dt').each(function(index, item) {
        var $item = $(item);

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
          domain.name = name;
          domains[name] = domain;
        }
        else {
          domain.type = 'Addon Domain';
          domains[parent].subdomains[name] = domain;
        }
      });

      return domains;
    });

    for (var name in this.data.domains) {
      var domain = this.data.domains[name];
      this.addJob(domain.path, 'getDomainData', [name], 'domain');
    }

    this.processJobQueue('domain');
  },

  getDomainData: function(name, step) {
    var domain = this.data.domains[name];

    var finished = false;

    if (!step) {
      log('Getting data for domain: ', name);
      this.load('ftp.php?', 'getDomainData', [name, 'ftp']);
    }
    else if (step === 'ftp') {
      domain.ftp = this.page.evaluate(function() {
        var ftp = [];

        $('form[action="ftp.php"]').each(function(index, item) {
          var form = $(item);

          var name = form.find('input[name=username]').val();
          var password = form.find('input[name=password]').val();
          var path = form.find('input[name=homedir]').val();

          if (name && password && path) {
            ftp.push({
              name: name,
              path: path,
              password: password
            });
          }
          else {
            console.log('Could not parse: ', form);
          }
        });

        return ftp;
      });

      this.load('mysql.php', 'getDomainData', [name, 'mysql']);
    }
    else if (step === 'mysql' || step==='postgresql') {
      var dbs = this.page.evaluate(function() {
        var dbs = [];

        $('input[name="Features_used_Number"]').each(function(index, item) {
          dbs.push($(item).val());
        });

        return dbs;
      });

      for (var i = 0; i < dbs.length; i++) {
        this.addJob(
          step + '.php?Features_used_Number=' + encodeURIComponent(dbs[i]) + '&' + step + 'action=edit',
          'getDomainData',
          [name, 'parse_db_' + step],
          'parse_db',
          true
        );
      }

      domain.databases = {
        mysql: {},
        postgresql: {}
      };

      if (step === 'mysql') {
        this.load('postgresql.php', 'getDomainData', [name, 'postgresql']);
      }
      else {
        // Add one final job that goes to next step.
        this.addJob(
          'dns_shared.php?dnsaction=dns',
          'getDomainData',
          [name, 'dns'],
          'parse_db'
        );
        this.processJobQueue('parse_db');
      }
    }
    else if (step === 'parse_db_mysql' || step === 'parse_db_postgresql') {
      var db = this.page.evaluate(function() {
        var db = {
          database: $('input[name=dbname]').val(),
          user: $('input[name=dbuser]').val(),
          password: $('input[name=passfull]').val(),
          host: $('input[name=server2]').val()
        };

        return db;
      });

      if (!(db.database && db.user && db.password && db.host)) {
        log('Could not parse database data');
      }
      else {
        var type = step.replace('parse_db_', '');
        domain.databases[type][db.database] = db;

        this.processJobQueue('parse_db');
      }
    }
    else if (step === 'dns') {
      log('Getting DNS');

      var records = this.page.evaluate(function() {
        var records = [];
        $('tr').each(function(index, item) {
          var $item = $(item);
          if ($item.find('input[name=hostname]').size() < 0) {
            return;
          }

          var record = {
            hostname: $item.find('input[name=hostname]').val(),
            ttl: $item.find('input[name=ttl]').val(),
            type: $item.find('select[name=dnsoptions]').val(),
            destination: $item.find('input[name=destination]').val()
          };
          if (record.hostname && record.type && record.destination) {
            records.push(record);
          }
        });
        return records;
      });

      domain.dns = records;

      this.load('subdomain.php', 'getDomainData', [name, 'subdomains']);
    }
    else if (step === 'subdomains') {
      var subdomains = this.page.evaluate(function() {
        var subdomains = [];
        $('tr').each(function(index, item) {
          var $item = $(item);

          var id = $item.find('input[name=feature_number]').val();
          if (!id) {
            return;
          }

          var dom = {
            id: id,
            path: $item.find('input[name="subdomain_path_fu[' + id + ']"]').val(),
            domain: $item.find('td').eq(1).html()
          };
          console.log(dom);
          if (dom.id && dom.domain && dom.path) {
            subdomains.push(dom);
          }
        });
        return subdomains;
      });

      domain.subdomains = subdomains;

      log('Finished getting data for domain ', name);

      if (!this.processJobQueue('domain')) {
        this.on_get_data();
      }
    }
    else {
      log('Unknown step: ', step);
    }
  },

  saveData: function() {
    var fs = require('fs');

    var path = 'path' in this.settings ?
      this.settings.path :
      fs.workingDirectory + fs.separator + 'konsoleh_' + this.settings.user + '.data.json';

    var file = fs.open(path, 'w');
    file.write(JSON.stringify(this.data));
    file.flush();
    file.close();
  }
};

kh.init();

}());
