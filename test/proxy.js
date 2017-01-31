'use strict'
var async = require('async')
var Sequelize = require("sequelize")
var config = require('../lib/config.js')
var JsonapiStoreRelationalDb = require('..')

var instances = { }

var DATABASE = 'jsonapi-relationaldb-test'

// TODO: Extract this somewhere common
var baseAttributes = {
  id: { type: new Sequelize.STRING(38), primaryKey: true },
  type: Sequelize.STRING,
  meta: {
    type: Sequelize.STRING,
    get: function() {
      var data = this.getDataValue("meta");
      if (!data) return undefined;
      return JSON.parse(data);
    },
    set: function(val) {
      return this.setDataValue("meta", JSON.stringify(val));
    }
  }
}

var schema = [
  {
    name: 'articles',
    attributes: Object.assign({}, baseAttributes, {
      title: { type: Sequelize.STRING },
      content: { type: Sequelize.TEXT },
      created: { type: Sequelize.STRING },
      status: { type: Sequelize.STRING },
      views: { type: Sequelize.INTEGER }
      //author, //jsonApi.Joi.one('people')
      //tags, //jsonApi.Joi.many('tags')
      //photos, // jsonApi.Joi.many('photos')
      //comments //jsonApi.Joi.many('comments')
    }),
    relations: (m, a) => {
      m.belongsTo(a['people'], {foreignKey: 'authorId', targetKey: 'id', as: 'author'});
      m.belongsToMany(a['tags'], {through: 'ArticleTags'});
      m.belongsToMany(a['photos'], {through: 'ArticlePhotos'});
      m.hasMany(a['comments'], {foreignKey: 'articleId', sourceKey: 'id'});
    }
  },
  {
    name: 'comments',
    attributes: Object.assign({}, baseAttributes, {
      body: { type: Sequelize.TEXT },
      timestamp: { type: Sequelize.STRING }
      //author, //jsonApi.Joi.one('people')
      //article //jsonApi.Joi.belongsToOne({resource: 'articles', as: 'comments'})
    }),
    relations: (m, a) => {
      m.belongsTo(a['people'], {foreignKey: 'authorId', targetKey: 'id',  as: 'author'});
      m.belongsTo(a['articles'], {foreignKey: 'articleId', targetKey: 'id', as: 'article'});
    }
  },
  {
    name: 'people',
    attributes: Object.assign({}, baseAttributes, {
      firstname: { type: Sequelize.STRING },
      lastname: { type: Sequelize.STRING },
      email: { type: Sequelize.STRING },
      //articles, //jsonApi.Joi.belongsToMany({resource: 'articles', as: 'author'})
      //photos //jsonApi.Joi.belongsToMany({resource: 'photos', as: 'photographer'})
    }),
    relations: (m, a) => {
      //m.hasMany(a['articles'], {foreignKey: 'authorId', sourceKey: 'id', as: 'author'});
      //m.hasMany(a['photos'], {foreignKey: 'photographerId', sourceKey: 'id', as: 'photographer'});
    }
  },
  {
    name: 'photos',
    attributes: Object.assign({}, baseAttributes, {
      title: { type: Sequelize.STRING },
      url: { type: Sequelize.STRING },
      height: { type: Sequelize.INTEGER },
      width: { type: Sequelize.INTEGER },
      raw: { type: Sequelize.BOOLEAN }
      //TODO: Figure out what's going on here?
      // tags, //jsonApi.Joi.array().items(jsonApi.Joi.string())
      //photographer, //jsonApi.Joi.one('people')
      //articles //jsonApi.Joi.belongsToMany({resource: 'articles', as: 'photos'})
    }),
    relations: (m, a) => {
      m.belongsTo(a['people'], {foreignKey: 'photographerId', targetKey: 'id', as: 'photographer'});
      m.belongsToMany(a['articles'], {through: 'ArticlePhotos'});
    }
  },
  {
    name: 'tags',
    attributes: Object.assign({}, baseAttributes, {
      name: { type: Sequelize.STRING },
      //articles, //jsonApi.Joi.belongsToMany({resource: 'articles', as: 'tags'}),
      //parent, // jsonApi.Joi.one('tags')
      //children //jsonApi.Joi.belongsToMany({resource: 'tags', as: 'parent'})
    }),
    relations: (m, a) => {
      m.belongsToMany(a['articles'], {through: 'ArticleTags'});
      m.belongsTo(a['tags'], {foreignKey: 'parentId', targetKey: 'id', as: 'parent'});
      m.hasMany(a['tags'], {foreignKey: 'parentId', sourceKey: 'id', as: 'children'});
    }
  },
  {
    name: 'tuples',
    attributes: Object.assign({}, baseAttributes, {
      //media, //jsonApi.Joi.many('articles', 'photos')
      //preferred // jsonApi.Joi.one('articles', 'photos')
    }),
    relations: () => {}
  },
  {
    name: 'ArticleTags',
    attributes: {},
    relations: () => {}
  },
  {
    name: 'ArticlePhotos',
    attributes: {},
    relations: () => {}
  }
]

var conf = config(DATABASE);
var database = conf.database;
var sequelize = new Sequelize(database, conf.username, conf.password, {
  dialect: conf.dialect,
  host: conf.host,
  port: conf.port,
  logging: conf.logging || require("debug")("jsonApi:store:relationaldb:sequelize")
});
var models = {};
schema.forEach(s => {
  models[s.name] = sequelize.define(s.name, s.attributes, { timestamps: false, freezeTableName: true });
});
schema.forEach(s => s.relations(models[s.name], models));

// Replace the MemoryStore default handler with our own version
require("jsonapi-server/lib/MemoryHandler")
module.children[4].exports = function() {
  var dbStore = new JsonapiStoreRelationalDb(config(DATABASE))
  dbStore.initialise = function (resourceConfig) {
    dbStore.config.baseModel = models[resourceConfig.resource]
    instances[resourceConfig.resource] = dbStore
    return JsonapiStoreRelationalDb.prototype.initialise.call(dbStore, resourceConfig)
  }
  // Keep the handler around for after the test rig is live
  return dbStore
};

// Load the jsonapi-server test suite
var fs = require('fs')
var path = require('path')
var base = path.join(__dirname, '../node_modules/jsonapi-server/test')
fs.readdirSync(base).forEach(function (filename) {
  var filePath = path.join(base, filename)
  if (!fs.lstatSync(filePath).isDirectory()) {
    require(filePath)
  }
})

var order = ['people', 'tags', 'photos', 'articles', 'comments', 'tuples']
before(function(done) {
  var tasks = [
    function(cb) {
      async.eachSeries([...order, 'ArticleTags', 'ArticlePhotos'], function(key, callback) {
        models[key].sync().asCallback(callback)
      }, cb)
    },
    function(cb) {
      async.eachSeries(order, function(key, callback) {
        var dbStore = instances[key]
        dbStore.populate(callback)
      }, cb)
    }
  ]

  async.series(tasks, done)
});
