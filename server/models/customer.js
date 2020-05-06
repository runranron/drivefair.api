const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const Order = require("./order");
const Address = require("./address");
const { emailTransporter } = require("../services/communications");
const OrderStatus = require("../constants/static-pages/order-status");
const { createCharge } = require("../services/payment");
const { ObjectId } = mongoose.Schema.Types;

const customerSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    index: true,
    maxlength: 64,
  },
  emailIsConfirmed: { type: Boolean, default: false },
  password: { type: String, required: true, maxlength: 128 },
  firstName: { type: String, maxlength: 64 },
  lastName: { type: String, maxlength: 64 },
  phoneNumber: { type: String },
  addresses: [{ type: ObjectId, ref: "Address" }],
  createdOn: { type: Date, default: Date.now },
  visits: [{ type: Date }],
  lastVisited: { type: Date, default: Date.now },
  cart: { type: ObjectId, ref: "Order" },
  activeOrders: [{ type: ObjectId, ref: "Order" }],
  completedOrders: [{ type: ObjectId, ref: "Order" }],
  orderHistory: [{ type: ObjectId, ref: "Order" }],
});

customerSchema.methods.validatePassword = async function (password) {
  return await bcrypt.compare(this.password, password);
};

customerSchema.methods.createCart = async function (orderItem, vendorId) {
  try {
    const newCart = new Order({
      customer: this._id,
      vendor: vendorId,
    });
    await newCart.addOrderItem(orderItem);
    this.cart = newCart;
    await this.save();
    return this.cart;
  } catch (error) {
    return { error, functionName: "createCart" };
  }
};

customerSchema.methods.getCart = async function () {
  try {
    const customerWithcart = await this.populate({
      path: "cart",
      populate: {
        path: "orderItems",
        populate: { path: "menuItem" },
      },
    }).execPopulate();
    return customerWithcart.cart;
  } catch (error) {
    return { error, functionName: "getCart" };
  }
};

customerSchema.methods.chargeCartToCard = async function (paymentToken) {
  try {
    const cart = await Order.findById(this.cart);
    const cartWithVendor = await cart.populate("vendor").execPopulate();
    const { vendor } = cartWithVendor;
    const charge = await createCharge(
      this,
      cartWithVendor,
      vendor,
      paymentToken
    );
    if (charge.error) {
      return { error: charge.error, functionName: "chargeToCard" };
    }
    const chargedCart = await cart.update({
      disposition: "PAID",
      chargeId: charge.id,
      amountPaid: charge.amount,
      modifiedOn: Date.now(),
    });
    vendor.activeOrders.push(cart._id);
    this.activeOrders.push(cart._id);
    this.cart = null;
    await vendor.save();
    await this.save();
    emailTransporter.sendMail({
      to: this.email,
      from: '"Denton Delivers", gabby@gabriellapelton.com',
      subject: `Your order for ${vendor.businessName}.`,
      html: OrderStatus.paidAndBeingMade(this.firstName, vendor.businessName),
    });
    emailTransporter.sendMail({
      to: vendor.email,
      from: '"Denton Delivers", gabby@gabriellapelton.com',
      subject: `You have a new order for ${cart.method}!`,
      html: OrderStatus.paidAndBeingMade(this.firstName, vendor.businessName),
    });
    return chargedCart;
  } catch (error) {
    return { error, functionName: "chargeCartToCard" };
  }
};

customerSchema.methods.selectAddress = async function (addressId) {
  try {
    const cart = await this.getCart();
    cart.address = addressId;
    await cart.save();
    return cart;
  } catch (error) {
    return { error };
  }
};

customerSchema.methods.addAddress = async function (address) {
  try {
    const newAddress = await new Address(address).save();
    this.addresses.push(newAddress._id);
    await this.save();
    return newAddress;
  } catch (error) {
    return { error };
  }
};

customerSchema.methods.deleteAddress = async function (addressId) {
  try {
    await Address.findByIdAndDelete(addressId);
    this.addresses.pull(addressId);
    await this.save();
    return this.addresses;
  } catch (error) {
    return { error };
  }
};

customerSchema.methods.editAddress = async function (addressId, changes) {
  try {
    const { activeOrders, completedOrders } = await this.populate(
      "activeOrders, completedOrders"
    ).execPopulate();
    if (
      [...activeOrders, ...completedOrders].find(
        (order) => order.address.toString() === addressId.toString()
      )
    ) {
      return {
        error:
          "Address has an order in process. Changing the address now may have unintended consequences.",
      };
    }
    const whiteList = [
      "street",
      "unit",
      "city",
      "state",
      "zip",
      "latitude",
      "longitude",
    ];
    const address = await Address.findById(addressId);
    whiteList.forEach((property) => {
      if (changes[property] !== undefined) {
        address[property] = changes[property];
      }
    });
    address.modifiedOn = Date.now();
    await address.save();
    const { addresses } = await this.populate("addresses").execPopulate();
    return addresses;
  } catch (error) {
    return { error };
  }
};

module.exports = mongoose.model("Customer", customerSchema);
