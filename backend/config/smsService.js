const axios = require("axios");

const sendAbsentSMS = async (parentPhone, studentName, date) => {
  try {
    const message = `Dear Parent, your child ${studentName} was marked ABSENT on ${date}. Please contact the school.`;

    const apiKey = (process.env.FAST2SMS_API_KEY || "").trim();

    console.log("\n----------------------------------------");
    console.log("[SENDING REAL SMS]");
    console.log(`Target Phone: ${parentPhone}`);
    console.log(`API Key Length: ${apiKey.length}`);

    if (!apiKey) {
      console.log(
        "Error: FAST2SMS_API_KEY environment variable is empty!"
      );
      return false;
    }

    // Fast2SMS API Call
    const response = await axios({
      method: "GET",
      url: "https://www.fast2sms.com/dev/bulkV2",

      headers: {
        authorization: apiKey,
        accept: "application/json"
      },

      params: {
        route: "q",
        message: message,
        language: "english",
        flash: "0",
        numbers: parentPhone
      }
    });

    console.log("Fast2SMS API Response:", response.data);
    console.log("----------------------------------------\n");

    return response.data && response.data.return === true;

  } catch (error) {
    console.error("Fast2SMS Error Details:");

    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Response:", error.response.data);
    } else {
      console.error(error.message);
    }

    console.log("----------------------------------------\n");

    return false;
  }
};

module.exports = { sendAbsentSMS };