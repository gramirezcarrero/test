exports.ratesValidations = {
    name: 'required|min:2|max:32|type:alphaNumericDash',
    prefix: 'required|max:20|type:numeric',
    number_of_digits: 'required|max:20|type:numeric',
    min_rate: 'required|max:2000|type:numeric',
    sec_rate: 'required|max:100|type:numeric',
    currency_id: 'required|max:16|type:numeric',
}