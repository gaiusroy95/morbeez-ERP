package com.morbeez.driver.ui.screens.requests

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RequestLogicTest {
    @Test fun `an advance needs an amount above zero and a reason`() {
        assertFalse(RequestLogic.ready(RequestForm(amount = "", reason = "diesel")))
        assertFalse(RequestLogic.ready(RequestForm(amount = "0", reason = "diesel")))
        assertFalse(RequestLogic.ready(RequestForm(amount = "2000", reason = "")))
        assertFalse(RequestLogic.ready(RequestForm(amount = "250000", reason = "too much")))
        assertTrue(RequestLogic.ready(RequestForm(amount = "2000", reason = "Tyre puncture")))
        assertEquals("2000.50", RequestLogic.amountOf(RequestForm(amount = "2000.50"))?.toPlainString())
    }

    @Test fun `a credit limit needs the customer and a limit, which may be zero`() {
        assertFalse(RequestLogic.ready(RequestForm(kind = "credit_limit", amount = "15000", reason = "wedding order")))
        assertTrue(RequestLogic.ready(RequestForm(kind = "credit_limit", customerId = "c1", amount = "15000", reason = "wedding order")))
        assertTrue(RequestLogic.ready(RequestForm(kind = "credit_limit", customerId = "c1", amount = "0", reason = "cash only now")))
        assertNull(RequestLogic.amountOf(RequestForm(kind = "credit_limit", amount = "-5")))
    }

    @Test fun `a new customer needs a name, and a phone only if one is given`() {
        assertFalse(RequestLogic.ready(RequestForm(kind = "new_customer", name = "S", reason = "new shop")))
        assertTrue(RequestLogic.ready(RequestForm(kind = "new_customer", name = "Sri Krishna Stores", reason = "new shop")))
        assertFalse(RequestLogic.ready(RequestForm(kind = "new_customer", name = "Sri Krishna Stores", phone = "12345", reason = "new shop")))
        assertTrue(RequestLogic.ready(RequestForm(kind = "new_customer", name = "Sri Krishna Stores", phone = "98000 00041", reason = "new shop")))
    }

    @Test fun `a phone is read as its ten digits`() {
        assertEquals("9800000041", RequestLogic.phoneOf("98000 00041"))
        assertEquals("9800000041", RequestLogic.phoneOf("+91 98000 00041"))
        assertNull(RequestLogic.phoneOf("98000"))
        assertNull(RequestLogic.phoneOf(""))
    }
}
