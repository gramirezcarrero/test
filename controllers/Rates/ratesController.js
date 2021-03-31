const pool = require('../../config/db');
const validateForm = require('../../validations/validator')
const { ratesValidations } = require('./ratesValidations');
const { checkConfConnection, callConfApi } = require('../../helpers/serverTools');

const successCode = "2501";
const errorCode = "2504";

const serverError = {
  code: errorCode,
  msg: {
    error: "serverError",
  }
};

// Handle code
exports.handleCode = async (apiCode, req, res) => {
    console.log({apiCode})
  try {
    switch (apiCode) {
      case "2500":
        return await showRates(req, res);
      case "2510":
        return await createRate(req, res);
      case "2513":
        return await deleteRate(req, res);
      case "2515":
        return await enableRate(req, res);
      case "2516":
        return await disableRate(req, res);
      case "2518":
        return await basicListRatesJoin(req,res);
      case "2519":
        return await basicListRates(req,res);
        case "2511":
        return await callRateList(req, res);
      default:
        return res.status(500).json(serverError);
    }
  } catch (error) {
    return res.status(500).json(serverError);
  }
}

// -- API METHODS -- //

// Show rates (2500)
const showRates = async (req, res) => {
  try {
    const rateId = parseInt(req.query.id) || '';

    // If id is empty
    if (rateId === '') {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "id is empty",
        }
      });
    }    
   
    // Gets queue data
    const result = await getRateData(rateId);
    
    // Not found
    if (!result) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "notFoundError",
        }
      });
    }
      
    return res.status(200).json({
      code: successCode,
      msg: {
        data: result,
      }
    });    
  } 
  catch (error) {
    return res.status(500).json(serverError);
  }  
}

// Get data (show)
const getRateData = async (id) => {

    // Gets data
    console.log(id)
    const result = await pool.query(`SELECT * FROM rates WHERE id = ?`, [id]);
    delete result["meta"];
  
    // Checks for errors
    if (!result || result.length < 1) return false;
    
    // Data
    const data = result[0];
  
    return data;
  }

const createRate = async (req, res) => {
    try {
      const dataQueueIn = req.body;
      console.log(req.body)
  
      // Validates form
      const formErrors = validateForm(dataQueueIn, ratesValidations);
  
      if (formErrors) {
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: formErrors,
          }
        });
      }
  
      // Checks .conf connection
      const validConfConnection = await checkConfConnection();
  
      if (!validConfConnection) {
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: ".conf connection error",
          }
        });
      }
  
      // Checks that name is not in use
      const nameResult = await pool.query(
        `SELECT 
        id
        FROM rates
        WHERE LOWER(name) = LOWER(?)`,
        
        [
          `${dataQueueIn.name}`
        ]
      );
      delete nameResult["meta"];
      
      if (nameResult.length > 0) {
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: "Name already exists",
          }
        });
      }
      console.log("before to save ", dataQueueIn)
      const saveQueueResult = await pool.query(
        `INSERT INTO
        rates 
        (${Object.keys(dataQueueIn).join(',')})
        VALUES ? `,
  
        [
          Object.keys(dataQueueIn).map(key => dataQueueIn[key])
        ]
      ); 
      delete saveQueueResult["meta"];
  
      // If it was not created
      if (saveQueueResult['insertId'] === 0){
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: "Record not created",
          }
        });
      }

  
      // Get queue data
      const showResult = await getRateData(saveQueueResult['insertId']);
      
      return res.status(200).json({
        code: successCode,
        msg: {
          data: showResult,
        }
      });
    }
    catch (error) {
        console.log(error)
      return res.status(500).json(serverError);
    }
  }

const deleteRate = async (req, res) => {
    try {
      const Id = parseInt(req.query.id) || '';
  
      // If id is empty
      if (Id === ''){
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: "id is empty",
          }
        });
      }
  
  
  
      // Checks .conf connection
      const validConfConnection = await checkConfConnection();
  
      if (!validConfConnection) {
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: ".conf connection error",
          }
        });
      }
    
      // Gets queue data
      const queueResult = await pool.query(`SELECT * FROM rates WHERE id = ?`, [Id]);
      delete queueResult["meta"];
      
      // Not found
      if (!queueResult || queueResult.length < 1) {
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: "notFoundError",
          }
        });
      }
  
      // Delete queue
      await pool.query(`DELETE FROM rates WHERE id = ? `, [Id]);
  
      // If everything is OK, return success response
      return res.status(200).json({
        code: successCode,
        msg: {
          data: {
            delete: true
          }
        }
      });
    } 
    catch (error) {
      return res.status(500).json(serverError);
    }
  }
const disableRate = async (req, res) => {
    try {
      const Id = parseInt(req.query.id) || '';
  
      // If id is empty
      if (Id === ''){
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: "id is empty",
          }
        });
      }
  
     
    
      // Checks if record exists
      const existResult = await pool.query(`SELECT id FROM rates WHERE id = ?`, [Id]);
      delete existResult["meta"];
      
      // Not found
      if (!existResult || existResult.length < 1) {
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: "notFoundError",
          }
        });
      }
  
      // Checks .conf connection
      const validConfConnection = await checkConfConnection();
  
      if (!validConfConnection) {
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: ".conf connection error",
          }
        });
      }
  
      // Change status to INACTIVE
      const resultUpdate = await pool.query(`UPDATE rates SET status = 'INACTIVE' WHERE id = ?`, [Id]); 
  
      // If status was not updated
      if (resultUpdate['affectedRows'] === 0){
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: "Status not updated!",
          }
        });
      }

  
      // If everything is OK, return success response
      return res.status(200).json({
        code: successCode,
        msg: {
          data: {
            inactive: true
          }
        }
      });
    } 
    catch (error) {
        console.log(error)
      return res.status(500).json(serverError);
    }
  }
const enableRate = async (req, res) => {
    console.log("ena")
    try {
        console.log("trying")
      const Id = parseInt(req.query.id) || '';
  
      // If id is empty
      if (Id === ''){
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: "id is empty",
          }
        });
      }
    
      // Checks if record exists
      const existResult = await pool.query(`SELECT id FROM rates WHERE id = ?`, [Id]);
      delete existResult["meta"];
      
      // Not found
      if (!existResult || existResult.length < 1) {
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: "notFoundError",
          }
        });
      }
  
      // Checks .conf connection
      const validConfConnection = await checkConfConnection();
  
      if (!validConfConnection) {
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: ".conf connection error",
          }
        });
      }
  
      // Change status to ACTIVE
      const resultUpdate = await pool.query(`UPDATE rates SET status = 'ACTIVE' WHERE id = ?`, [Id]); 
  
      // If status was not updated
      if (resultUpdate['affectedRows'] === 0){
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: "Status not updated!",
          }
        });
      }
  
  
      // If everything is OK, return success response
      return res.status(200).json({
        code: successCode,
        msg: {
          data: {
            active: true
          }
        }
      });
    } 
    catch (error) {
        console.log(error)
      return res.status(500).json(serverError);
    }
  }
  const basicListRatesJoin = async (_req, res) => {
    try {
        const queuesResult = await pool.query(
            `
            SELECT concat(currency,symbol) as value, rates.name, rates.id FROM rates join currencies on currencies.id = rates.currency_id
            `
            );
    delete queuesResult["meta"];
    // Returns data
    return res.status(200).json({
      code: successCode,
      msg: {
        data: queuesResult
      }
    });
  }
  catch (error) {
      console.log(err)
    return res.status(500).json(serverError);
  }
};
  const basicListRates = async (_req, res) => {
      try {
         const queuesResult = await pool.query(
              `
              SELECT 
              id, 
              name
              FROM rates
              `
              );
              console.log("aaaaa")
      delete queuesResult["meta"];
      // Returns data
      return res.status(200).json({
        code: successCode,
        msg: {
          data: queuesResult
        }
      });
    }
    catch (error) {
        console.log(err)
      return res.status(500).json(serverError);
    }
  };
  const callRateList = async (req, res) => {
    try {
        
      const filters = req.body.filters || {};
  
      const perpage = Number(req.body.perpage || 10);
      const page = Number(req.body.page || 1);
  
      const orderField = String(req.body.orderField || "name");
      const order = String(req.body.order || "asc");
  
      const name = String(filters.name || '');
  
      // Order must be "asc" or "desc"
      if (!(["asc", "desc"].includes(order.toLowerCase()))) {
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: "order must be asc or desc",
          }
        });
      }
  
      // Orderfield must be one of the following fields
      const orderFields = ["name", "status"];
  
      if (!(orderFields.includes(orderField.toLowerCase()))) {
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: "Invalid orderField",
          }
        });
      }
  
      // WHERE query
      const whereQuery = name.length > 0 ? `WHERE r.name LIKE CONCAT(?, '%')` : '';
  
      // WHERE parameters
      const whereParam = [
        ...(name.length > 0 ? [name] : [])
      ]
  
      // Gets list data
      const resultData = await pool.query(
        `SELECT 
        r.id,
        IFNULL(r.name, '') as name,
        IFNULL(r.prefix, '') as prefix,
        concat(c.currency,c.symbol) as currency,
        IFNULL(r.min_rate, '') as rate_min,
        IFNULL(r.sec_rate, '') as rate_sec,
        IFNULL(r.status, '') as status
        FROM rates r
        JOIN 
        currencies c ON c.id = r.currency_id
        ${whereQuery}
        GROUP BY r.id
        ORDER BY ${orderField} ${order} 
        LIMIT ? 
        OFFSET ?`,
        
        [
          ... whereParam,
          perpage,
          ((page - 1) * perpage),
        ]
      );
      delete resultData["meta"];
      console.log("FW-----")
      // Gets totals data
      const resultTotals = await pool.query(
        `SELECT 
          COUNT(DISTINCT id) AS records 
        FROM rates r
        ${whereQuery}`,
  
        [
          ... whereParam
        ]
      );
  
      delete resultTotals["meta"];
  
      // Checks for errors
      if (!resultTotals) {
        throw "resultTotals error";
      }
  
      // If resultData is empty
      if (resultData.length < 1) {
        return res.status(200).json({
          code: successCode,
          msg: {
            data: resultData,
          }
        });
      }
  
      // Structures list data
      const listData = [];
      for (let i = 0; i < resultData.length; i++) {                
        const item = resultData[i];
        listData.push({
          id: item.id,
          tr: [
            {
              td: 'name',
              value: item.name,
            },
            {
              td: "prefix",
              value: item.prefix !== '' ? item.prefix : false
            },
            {
              td: "currency",
              value: item.currency !== '' ? item.currency : false
            },
            {
              td: "rate_min",
              value: item.rate_min
            },
            {
              td: "rate_sec",
              value: item.rate_min
            },
            {
              td: "status",
              value: item.status
            }
          ]
        })
      }
      
      // Return list data
      const totalhits = resultTotals.reduce((accumulator, currentValue) => accumulator += currentValue.records, 0);
      return res.status(200).json({
        code: successCode,
        msg: {
          data: listData,
          from: ((page - 1) * perpage) + 1,
          to: Math.min(((page - 1) * perpage) + perpage, totalhits),
          per_page: Number(perpage),
          totalhits: totalhits,
          current_page: Number(page)
        }
      });
    } 
    catch (error) {
        console.log(error)
      return res.status(500).json(serverError);
    }
  }