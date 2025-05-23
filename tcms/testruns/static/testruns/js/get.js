import { fetchBugDetails } from '../../../../static/js/bugs'
import { jsonRPC } from '../../../../static/js/jsonrpc'
import { propertiesCard } from '../../../../static/js/properties'
import { tagsCard } from '../../../../static/js/tags'
import {
    advancedSearchAndAddTestCases, animate,
    arrayToDict, bindDeleteCommentButton,
    changeDropdownSelectedItem, currentTimeWithTimezone,
    markdown2HTML, renderCommentsForObject, renderCommentHTML,
    quickSearchAndAddTestCase, treeViewBind,
    findSelectorsToShowAndHide, findSelectorsToShowAndHideFromAPIData,
    showOrHideMultipleRows
} from '../../../../static/js/utils'
import { initSimpleMDE } from '../../../../static/js/simplemde_security_override'

const allExecutionStatuses = {}
const allExecutions = {}
const expandedExecutionIds = []
const permissions = {
    removeTag: false,
    addComment: false,
    removeComment: false,
    viewHistoricalTestExecution: false
}
const autocompleteCache = {}

function showLastBugForTe (testExecutionRow, bugUrl) {
    const jsBugs = testExecutionRow.find('.js-bugs')
    jsBugs.removeClass('hidden')

    const lastBugAnchor = jsBugs.find('a')
    lastBugAnchor.attr('href', bugUrl)

    jsonRPC('Bug.details', bugUrl, (details) => {
        lastBugAnchor.text(`${details.id} - ${details.status}`)
        lastBugAnchor.attr('title', details.title)
    })
}

export function pageTestrunsGetReadyHandler () {
    permissions.removeTag = $('#test_run_pk').data('perm-remove-tag') === 'True'
    permissions.addComment = $('#test_run_pk').data('perm-add-comment') === 'True'
    permissions.removeComment = $('#test_run_pk').data('perm-remove-comment') === 'True'
    permissions.viewHistoricalTestExecution = $('#test_run_pk').data('perm-view-historical-testexecution') === 'True'

    const testRunId = $('#test_run_pk').data('pk')

    propertiesCard(testRunId, 'run', 'TestRun.properties', undefined, undefined)

    $('#start-button').on('click', function () {
        const timeZone = $('#clock').data('time-zone')
        const now = currentTimeWithTimezone(timeZone)

        jsonRPC('TestRun.update', [testRunId, { start_date: now }], testRun => {
            const startDate = moment(testRun.start_date).format('DD MMM YYYY, HH:mm a')
            $('.start-date').html(startDate)
            $(this).hide()
        })
    })

    $('#stop-button').on('click', function () {
        const timeZone = $('#clock').data('time-zone')
        const now = currentTimeWithTimezone(timeZone)

        jsonRPC('TestRun.update', [testRunId, { stop_date: now }], testRun => {
            const stopDate = moment(testRun.stop_date).format('DD MMM YYYY, HH:mm a')
            $('.stop-date').html(stopDate)
            $(this).hide()
            $('#test_run_pk').parent('h1').css({ 'text-decoration': 'line-through' })
        })
    })

    $('.js-bulk-create-testrun').click(function () {
        $(this).parents('.dropdown').toggleClass('open')

        const selected = selectedCheckboxes()
        if ($.isEmptyObject(selected)) {
            return false
        }

        const planId = Number($('#test_run_pk').data('plan-pk'))
        window.location.assign(`/runs/new?p=${planId}&c=${selected.caseIds.join('&c=')}`)

        return false
    })

    $('.add-comment-bulk').click(function () {
        $(this).parents('.dropdown').toggleClass('open')

        const selected = selectedCheckboxes()
        if ($.isEmptyObject(selected)) {
            return false
        }

        const enterCommentText = $('#test_run_pk').data('trans-comment')
        const comment = prompt(enterCommentText)
        if (!comment) {
            return false
        }

        selected.executionIds.forEach(executionId => {
            jsonRPC('TestExecution.add_comment', [executionId, comment], () => {
                reloadRowFor(allExecutions[executionId])
            })
        })

        return false
    })

    $('.add-hyperlink-bulk').click(function () {
        $(this).parents('.dropdown').toggleClass('open')

        const selected = selectedCheckboxes()
        if ($.isEmptyObject(selected)) {
            return false
        }

        return addLinkToExecutions(selected.executionIds)
    })

    $('.remove-execution-bulk').click(function () {
        $(this).parents('.dropdown').toggleClass('open')
        const selected = selectedCheckboxes()
        if ($.isEmptyObject(selected)) {
            return false
        }

        const areYouSureText = $('#test_run_pk').data('trans-are-you-sure')
        if (confirm(areYouSureText)) {
            removeCases(selected.executionIds)
        }

        return false
    })

    $('.change-assignee-bulk').click(function () {
        $(this).parents('.dropdown').toggleClass('open')
        changeAssigneeBulk()

        return false
    })

    $('.update-case-text-bulk').click(function () {
        $(this).parents('.dropdown').toggleClass('open')
        updateCaseText()

        return false
    })

    $('.bulk-change-status').click(function () {
        $(this).parents('.dropdown').toggleClass('open')
        // `this` is the clicked link
        const statusId = $(this).data('status-id')
        changeStatusBulk(statusId)

        // so that we don't follow the link
        return false
    })

    // bind everything in tags table
    tagsCard('TestRun', testRunId, { run: testRunId }, permissions.removeTag)

    jsonRPC('TestExecutionStatus.filter', {}, executionStatuses => {
        // convert from list to a dict for easier indexing later
        for (let i = 0; i < executionStatuses.length; i++) {
            allExecutionStatuses[executionStatuses[i].id] = executionStatuses[i]
        }

        const rpcQuery = { run_id: testRunId }

        // if page has URI params then try filtering, e.g. by status
        const filterParams = new URLSearchParams(location.search)
        if (filterParams.has('status_id')) {
            rpcQuery.status_id__in = filterParams.getAll('status_id')
        }

        jsonRPC('TestExecution.filter', rpcQuery, testExecutions => {
            drawPercentBar(testExecutions, false)
            renderTestExecutions(testExecutions)
            renderAdditionalInformation(testRunId)
        })
    })

    $('.bulk-select-checkbox').click(event => {
        const isChecked = event.target.checked
        const testExecutionSelectors = $('#test-executions-container').find('.test-execution-checkbox:visible')

        testExecutionSelectors.each((_index, te) => { te.checked = isChecked })
    })

    quickSearchAndAddTestCase(testRunId, addTestCaseToRun, autocompleteCache, { case_status__is_confirmed: true })
    $('#btn-search-cases').click(function () {
        return advancedSearchAndAddTestCases(
            testRunId, 'TestRun.add_case', $(this).attr('href'),
            $('#test_run_pk').data('trans-error-adding-cases')
        )
    })

    $('.js-toolbar-filter-options li').click(function (ev) {
        return changeDropdownSelectedItem(
            '.js-toolbar-filter-options',
            '#input-filter-button',
            ev.target,
            $('#toolbar-filter')
        )
    })

    $('#toolbar-filter').on('keyup', function () {
        const filterValue = $(this).val().toLowerCase()
        const filterBy = $('.js-toolbar-filter-options .selected')[0].dataset.filterType

        filterTestExecutionsByProperty(
            testRunId,
            Object.values(allExecutions),
            filterBy,
            filterValue
        )
    })

    // assigned-to-me button
    document.getElementById('id_assigned_to_me').onchange = () => {
        const isChecked = $('#id_assigned_to_me').is(':checked')
        const filterValue = isChecked ? $('#test_run_pk').data('current-user') : ''

        // update the filter widget which will do the actual filtering
        changeDropdownSelectedItem(
            '.js-toolbar-filter-options',
            '#input-filter-button',
            $('.js-toolbar-filter-options [data-filter-type="assignee__username"]').find('a')[0],
            $('#toolbar-filter')
        )
        $('#toolbar-filter').val(filterValue)
        $('#toolbar-filter').keyup()
    }

    // email notifications card
    $('#add-cc').click(() => {
        const username = prompt($('#test_run_pk').data('trans-enter-assignee-name-or-email'))

        if (!username) {
            return false
        }

        jsonRPC('TestRun.add_cc', [testRunId, username], result => {
            // todo: instead of reloading render this in the form above
            window.location.reload(true)
        })
    })

    $('.js-remove-cc').click((event) => {
        const uid = $(event.target).parent('[data-uid]').data('uid')

        jsonRPC('TestRun.remove_cc', [testRunId, uid], result => {
            $(event.target).parents('tr').hide()
        })
    })
}

function isFiltered () {
    const filterParams = new URLSearchParams(location.search)
    return $('#toolbar-filter').val() !== '' || filterParams.has('status_id')
}

function filterTestExecutionsByProperty (runId, executions, filterBy, filterValue) {
    // no input => show all rows
    if (filterValue.trim().length === 0) {
        $('.test-execution-element').show()
        $('.test-executions-count').text(executions.length)
        return
    }

    if (filterBy === 'is_automated' && filterValue !== '0' && filterValue !== '1') {
        alert($('#test_run_pk').data('trans-bool-value-required'))
        return
    }

    $('.test-execution-element').hide()

    if (filterBy === 'is_automated' || filterBy === 'priority' || filterBy === 'category') {
        const query = { run: runId }
        if (filterBy === 'is_automated') {
            query.case__is_automated = filterValue
        } else if (filterBy === 'priority') {
            query.case__priority__value__icontains = filterValue
        } else if (filterBy === 'category') {
            query.case__category__name__icontains = filterValue
        }

        // note: querying TEs so that -FromAPIData() can work properly!
        jsonRPC('TestExecution.filter', query, function (filtered) {
            // hide again if a previous async request showed something else
            $('.test-execution-element').hide()

            const rows = findSelectorsToShowAndHideFromAPIData(executions, filtered, '.test-execution-{0}')
            showOrHideMultipleRows('.test-execution-element', rows)
            $('.test-executions-count').text(rows.show.length)
        })
    } else {
        const rows = findSelectorsToShowAndHide(executions, filterBy, filterValue, '.test-execution-{0}')
        showOrHideMultipleRows('.test-execution-element', rows)
        $('.test-executions-count').text(rows.show.length)
    }
}

function addTestCaseToRun (runId) {
    const caseName = $('#search-testcase')[0].value
    const testCase = autocompleteCache[caseName]

    // test case is already present so don't add it
    const allCaseIds = Object.values(allExecutions).map(te => te.case)
    if (allCaseIds.indexOf(testCase.id) > -1) {
        $('#search-testcase').val('')
        return false
    }

    jsonRPC('TestRun.add_case', [runId, testCase.id], function (result) {
        // IMPORTANT: the API result includes a 'sortkey' field value!
        window.location.reload(true)

        // TODO: remove the page reload above and add the new case to the list
        $('#search-testcase').val('')
    })
}

function selectedCheckboxes () {
    const allSelected = $('.test-execution-checkbox:checked')

    if (!allSelected.length) {
        const warningText = $('#test_run_pk').data('trans-no-executions-selected')
        alert(warningText)

        return {}
    }

    const testCaseIds = []
    const testExecutionIds = []
    allSelected.each((_index, checkbox) => {
        checkbox = $(checkbox)

        const testExecutionId = checkbox.data('test-execution-id')
        testExecutionIds.push(testExecutionId)

        const testCaseId = checkbox.data('test-execution-case-id')
        testCaseIds.push(testCaseId)
    })

    return {
        caseIds: testCaseIds,
        executionIds: testExecutionIds
    }
}

function drawPercentBar (testExecutions, updateTestRun = false) {
    let positiveCount = 0
    let negativeCount = 0
    const allCount = testExecutions.length
    const statusCount = {}
    Object.values(allExecutionStatuses).forEach(s => (statusCount[s.name] = { count: 0, id: s.id }))

    testExecutions.forEach(testExecution => {
        const executionStatus = allExecutionStatuses[testExecution.status]

        if (executionStatus.weight > 0) {
            positiveCount++
        } else if (executionStatus.weight < 0) {
            negativeCount++
        }

        statusCount[executionStatus.name].count++
    })

    renderProgressBars(positiveCount, negativeCount, allCount)
    renderCountPerStatusList(statusCount)

    if (updateTestRun) {
        // first non-zero status reported => TR is started
        if (positiveCount + negativeCount === 1 && $('.start-date').html().trim().replace('-', '') === '') {
            $('#start-button').click()
            return
        }

        // there are no more neutral executions left => TR is finished; update timestamp
        if (positiveCount + negativeCount === allCount && $('.stop-date').html().trim().replace('-', '') === '') {
            $('#stop-button').click()
        }
    }
}

function renderProgressBars (positiveCount, negativeCount, allCount) {
    const positivePercent = +(positiveCount / allCount * 100).toFixed(2)
    const positiveBar = $('.progress > .progress-completed')
    if (positivePercent) {
        positiveBar.text(`${positivePercent}%`)
    }
    positiveBar.css('width', `${positivePercent}%`)
    positiveBar.attr('aria-valuenow', `${positivePercent}`)

    const negativePercent = +(negativeCount / allCount * 100).toFixed(2)
    const negativeBar = $('.progress > .progress-failed')
    if (negativePercent) {
        negativeBar.text(`${negativePercent}%`)
    }
    negativeBar.css('width', `${negativePercent}%`)
    negativeBar.attr('aria-valuenow', `${negativePercent}`)

    const neutralPercent = +(100 - (negativePercent + positivePercent)).toFixed(2)
    const neutralBar = $('.progress > .progress-bar-remaining')
    if (neutralPercent) {
        neutralBar.text(`${neutralPercent}%`)
    }
    neutralBar.css('width', `${neutralPercent}%`)
    neutralBar.attr('aria-valuenow', `${neutralPercent}`)

    $('.total-execution-count').text(allCount)
}

function renderCountPerStatusList (statusCount) {
    for (const status in statusCount) {
        const statusId = statusCount[status].id

        $(`#count-for-status-${statusId}`).attr('href', `?status_id=${statusId}`).text(statusCount[status].count)
    }
}

function renderTestExecutions (testExecutions) {
    // sort executions by sortkey
    testExecutions.sort(function (te1, te2) {
        return te1.sortkey - te2.sortkey
    })
    const container = $('#test-executions-container')

    testExecutions.forEach(testExecution => {
        container.append(renderTestExecutionRow(testExecution))
    })

    bindEvents()

    $('.test-executions-count').html(testExecutions.length)
}

function bindEvents (selector) {
    treeViewBind(selector)

    $('.test-execution-element').click(function (ev) {
    // don't trigger row expansion when kebab menu is clicked
        if ($(ev.target).is('button, a, input, .fa-ellipsis-v')) {
            return
        }

        const tePK = $(ev.target)
            .parents('.test-execution-element')
            .find('.test-execution-checkbox')
            .data('test-execution-id')

        // row was expanded once, dom is ready
        if (expandedExecutionIds.indexOf(tePK) > -1) {
            return
        }
        expandedExecutionIds.push(tePK)

        getExpandArea(allExecutions[tePK])
    })
}

function getExpandArea (testExecution) {
    const container = $(`.test-execution-${testExecution.id}`)

    container.find('.test-execution-information .run-date').html(testExecution.stop_date || '-')
    container.find('.test-execution-information .build').html(testExecution.build__name)
    container.find('.test-execution-information .text-version').html(testExecution.case_text_version)

    jsonRPC('TestCase.history',
        [testExecution.case, {
            history_id: testExecution.case_text_version
        }], (data) => {
            data.forEach((entry) => {
                markdown2HTML(entry.text, container.find('.test-execution-text')[0])
                container.find('.test-execution-notes').append(entry.notes)
            })
        })

    const commentsRow = container.find('.comments')
    const simpleMDEinitialized = container.find('.comment-form').data('simple-mde-initialized')
    if (!simpleMDEinitialized) {
        const textArea = container.find('textarea')[0]
        const fileUpload = container.find('input[type="file"]')
        const editor = initSimpleMDE(textArea, $(fileUpload), textArea.id)
        container.find('.comment-form').data('simple-mde-initialized', true)

        container.find('.post-comment').click(() => {
            const input = editor.value().trim()

            if (input) {
                jsonRPC('TestExecution.add_comment', [testExecution.id, input], comment => {
                    editor.value('')

                    commentsRow.append(renderCommentHTML(
                        1 + container.find('.js-comment-container').length,
                        comment,
                        $('template#comment-template')[0],
                        parentNode => {
                            bindDeleteCommentButton(
                                testExecution.id,
                                'TestExecution.remove_comment',
                                permissions.removeComment,
                                parentNode)
                        }))
                })
            }
        })

        container.find('.change-status-button').click(function () {
            const statusId = $(this).attr('data-status-id')

            const comment = editor.value().trim()
            addCommentToExecution(testExecution, comment, () => {
                editor.value('')
            })

            const $this = $(this)
            jsonRPC('TestExecution.update', [testExecution.id, testExecutionUpdateArgs(statusId)], execution => {
                // update TestRun if not filtered
                reloadRowFor(execution, !isFiltered())

                $this.parents('.list-group-item-container').addClass('hidden')
                // click the .list-group-item-header, not the .test-execution-element itself, because otherwise the handler will fail
                $this.parents('.test-execution-element').next().find('.list-group-item-header').click()
            })
        })
    }

    renderCommentsForObject(
        testExecution.id,
        'TestExecution.get_comments',
        'TestExecution.remove_comment',
        permissions.removeComment,
        commentsRow
    )

    jsonRPC('TestExecution.get_links', { execution_id: testExecution.id }, links => {
        const ul = container.find('.test-execution-hyperlinks')
        ul.innerHTML = ''
        links.forEach(link => ul.append(renderLink(link)))
        bindDeleteLinkButton()
    })

    jsonRPC('TestCase.list_attachments', [testExecution.case], attachments => {
        const ul = container.find('.test-case-attachments')

        if (!attachments.length) {
            ul.find('.hidden').removeClass('hidden')
            return
        }

        const liTemplate = $('#attachments-list-item')[0].content

        attachments.forEach(attachment => {
            const li = liTemplate.cloneNode(true)
            const attachmentLink = $(li).find('a')[0]

            attachmentLink.href = attachment.url
            attachmentLink.innerText = attachment.url.split('/').slice(-1)[0]
            ul.append(li)
        })
    })

    if (permissions.viewHistoricalTestExecution) {
        jsonRPC('TestExecution.history', testExecution.id, history => {
            const historyContainer = container.find('.history-container')
            history.forEach(h => {
                historyContainer.append(renderHistoryEntry(h))
            })
        })
    }
}

function addCommentToExecution (testExecution, input, handler) {
    if (!input) {
        return
    }

    jsonRPC('TestExecution.add_comment', [testExecution.id, input], handler)
}

function renderAdditionalInformation (testRunId, execution) {
    let linksQuery = { execution__run: testRunId }
    let casesQuery = { executions__run: testRunId }
    let componentQ = { cases__executions__run: testRunId }
    let tagsQ = { case__executions__run: testRunId }
    let propertiesQ = { execution__run: testRunId }
    const planId = Number($('#test_run_pk').data('plan-pk'))

    // if called from reloadRowFor(execution) then filter only for
    // that one row
    if (execution) {
        linksQuery = { execution: execution.id }
        casesQuery = { executions: execution.id }
        componentQ = { cases__executions: execution.id }
        tagsQ = { case__executions: execution.id }
        propertiesQ = { execution: execution.id }
    }

    // update bug icons for all executions
    jsonRPC('TestExecution.get_links', linksQuery, (links) => {
        const withDefects = {}
        links.forEach((link) => {
            if (link.is_defect) {
                withDefects[link.execution] = link
            }
        })
        for (const teId of Object.keys(withDefects)) {
            const lastBug = withDefects[teId]
            showLastBugForTe($(`.test-execution-${teId}`), lastBug.url)
        }
    })

    // update properties display
    jsonRPC('TestExecution.properties', propertiesQ, (props) => {
        const propsPerTe = props.reduce(function (map, obj) {
            if (!(obj.execution in map)) {
                map[obj.execution] = {}
            }
            map[obj.execution][obj.name] = obj.value
            return map
        }, {})

        for (const teId of Object.keys(propsPerTe)) {
            const row = $(`.test-execution-${teId}`)

            // when loading this page filtered by status some TCs do not exist
            // but we don't know about it b/c the above queries are overzealous
            if (!row.length) { continue }

            let propString = ''
            for (const name of Object.keys(propsPerTe[teId])) {
                propString += `${name}: ${propsPerTe[teId][name]}; `
            }

            const propertiesRow = row.find('.js-row-properties')
            propertiesRow.toggleClass('hidden')
            propertiesRow.html(propertiesRow.html() + propString + '<br>')
        }
    })

    // update priority, category & automation status for all executions
    // also tags & components via nested API calls
    jsonRPC('Component.filter', componentQ, components => {
        jsonRPC('Tag.filter', tagsQ, tags => {
            jsonRPC('TestCase.filter', casesQuery, testCases => {
                jsonRPC('TestCase.filter', { plan: planId }, function (casesInPlan) {
                    casesInPlan = arrayToDict(casesInPlan)
                    casesInPlan = Object.keys(casesInPlan).map(id => parseInt(id))

                    for (const testCase of testCases) {
                        let rowSelector = `.test-execution-case-${testCase.id}`
                        // Preferably operate over the exact execution row to prevent
                        // appending new HTML onto existing values, e.g. Tags. See #3367
                        //
                        // Root cause of the bug in #3367 is that some fields contain icons
                        // and pre-existing HTML coming from the template and we can't call .empty()
                        // on them. When such TE is parametrized then there are multiple HTML rows
                        // matching `rowSelector`/`testCase.id`, therefore the UI is appended to many times!
                        if (execution) {
                            rowSelector += `.test-execution-${execution.id}`
                        }
                        const row = $(rowSelector)

                        // when loading this page filtered by status some TCs do not exist
                        // but we don't know about it b/c the above queries are overzealous
                        if (!row.length) { continue }

                        row.find('.test-execution-priority').html(testCase.priority__value)
                        row.find('.test-execution-category').html(testCase.category__name)

                        const isAutomatedElement = row.find('.test-execution-automated')
                        const isAutomatedIcon = testCase.is_automated ? 'fa-cog' : 'fa-hand-paper-o'
                        const isAutomatedAttr = testCase.is_automated ? isAutomatedElement.data('automated') : isAutomatedElement.data('manual')
                        isAutomatedElement.addClass(isAutomatedIcon)
                        isAutomatedElement.attr('title', isAutomatedAttr)

                        // test case isn't part of the parent test plan
                        if (casesInPlan.indexOf(testCase.id) === -1) {
                            row.find('.js-tc-not-in-tp').toggleClass('hidden')
                        }

                        // render tags and components if available
                        testCase.tagNames = []
                        // todo: this is sub-optimal b/c it searches whether tag is attached
                        // to the current testCase and does so for every case in the list
                        for (let i = 0; i < tags.length; i++) {
                            if (tags[i].case === testCase.id && testCase.tagNames.indexOf(tags[i].name) === -1) {
                                testCase.tagNames.push(tags[i].name)
                            }
                        }
                        if (testCase.tagNames.length) {
                            const tagsRow = row.find('.js-row-tags')
                            tagsRow.toggleClass('hidden')
                            tagsRow.html(tagsRow.html() + testCase.tagNames.join(', '))
                        }

                        testCase.componentNames = []
                        // todo: this is sub-optimal b/c it searches whether component is attached
                        // to the current testCase and does so for every case in the list
                        for (let i = 0; i < components.length; i++) {
                            if (components[i].cases === testCase.id) {
                                testCase.componentNames.push(components[i].name)
                            }
                        }
                        if (testCase.componentNames.length) {
                            const componentsRow = row.find('.js-row-components')
                            componentsRow.toggleClass('hidden')
                            componentsRow.html(componentsRow.html() + testCase.componentNames.join(', '))
                        }

                        // update internal data structure
                        const teID = row.find('.test-execution-checkbox').data('test-execution-id')
                        allExecutions[teID].tags = testCase.tagNames
                        allExecutions[teID].components = testCase.componentNames
                    }
                })
            })
        })
    })
}

function renderHistoryEntry (historyEntry) {
    if (!historyEntry.history_change_reason) {
        return ''
    }

    const template = $($('#history-entry')[0].content.cloneNode(true))

    template.find('.history-date').html(historyEntry.history_date)
    template.find('.history-user').html(historyEntry.history_user__username)

    // convert to markdown code block for the diff language
    const changeReason = `\`\`\`diff\n${historyEntry.history_change_reason}\n\`\`\``
    markdown2HTML(changeReason, template.find('.history-change-reason')[0])

    return template
}

function renderTestExecutionRow (testExecution) {
    // refresh the internal data structure b/c some fields are used
    // to render the expand area and may have changed via bulk-update meanwhile
    testExecution.status__name = $('#test_run_pk').data(`trans-execution-status-${testExecution.status}`)
    allExecutions[testExecution.id] = testExecution

    const testExecutionRowTemplate = $('#test-execution-row')[0].content
    const template = $(testExecutionRowTemplate.cloneNode(true))

    template.find('.test-execution-checkbox').data('test-execution-id', testExecution.id)
    template.find('.test-execution-checkbox').data('test-execution-case-id', testExecution.case)
    template.find('.test-execution-element').attr('id', `test-execution-${testExecution.id}`)
    template.find('.test-execution-element').addClass(`test-execution-${testExecution.id}`)
    template.find('.test-execution-element').addClass(`test-execution-case-${testExecution.case}`)
    template.find('.test-execution-info').html(`TE-${testExecution.id}/TC-${testExecution.case}:`)
    template.find('.test-execution-info-link').html(testExecution.case__summary)
    template.find('.test-execution-info-link').attr('href', `/case/${testExecution.case}/`)
    template.find('.test-execution-tester').html(testExecution.tested_by__username || '-')
    template.find('.test-execution-asignee').html(testExecution.assignee__username || '-')

    const testExecutionStatus = allExecutionStatuses[testExecution.status]
    template.find('.test-execution-status-icon').addClass(testExecutionStatus.icon).css('color', testExecutionStatus.color)
    template.find('.test-execution-status-name').html(testExecution.status__name).css('color', testExecutionStatus.color)

    template.find('.add-link-button').click(() => addLinkToExecutions([testExecution.id]))
    template.find('.one-click-bug-report-button').click(() => fileBugFromExecution(testExecution))

    // remove from expanded list b/c data may have changed
    expandedExecutionIds.splice(expandedExecutionIds.indexOf(testExecution.id), 1)

    // WARNING: only comments related stuff below
    if (!permissions.addComment) {
        template.find('.comment-form').hide()
        return template
    }

    template.find('textarea')[0].id = `comment-for-testexecution-${testExecution.id}`
    template.find('input[type="file"]')[0].id = `file-upload-for-testexecution-${testExecution.id}`

    return template
}

function changeStatusBulk (statusId) {
    const selected = selectedCheckboxes()
    if ($.isEmptyObject(selected)) {
        return false
    }

    const updateArgs = testExecutionUpdateArgs(statusId)
    selected.executionIds.forEach(executionId => {
        jsonRPC('TestExecution.update', [executionId, updateArgs], execution => {
            // update TestRun if not filtered
            reloadRowFor(execution, !isFiltered())
        })
    })
}

function reloadRowFor (execution, updateTestRun = false) {
    const testExecutionRow = $(`.test-execution-${execution.id}`)
    animate(testExecutionRow, () => {
        testExecutionRow.replaceWith(renderTestExecutionRow(execution))
        // note: this is here b/c animate() is async and we risk race conditions
        // b/c we use global variables for state. The drawback is that progress
        // will be updated even if statuses aren't changed !!!
        drawPercentBar(Object.values(allExecutions), updateTestRun)
        renderAdditionalInformation(execution.run_id, execution)

        bindEvents(`.test-execution-${execution.id}`)
    })
}

function changeAssigneeBulk () {
    const selected = selectedCheckboxes()
    if ($.isEmptyObject(selected)) {
        return false
    }

    const enterAssigneeText = $('#test_run_pk').data('trans-enter-assignee-name-or-email')
    const assignee = prompt(enterAssigneeText)

    if (!assignee) {
        return false
    }
    selected.executionIds.forEach(executionId => {
        jsonRPC('TestExecution.update', [executionId, { assignee }], execution => {
            reloadRowFor(execution)
        })
    })
}

function updateCaseText () {
    const selected = selectedCheckboxes()
    if ($.isEmptyObject(selected)) {
        return false
    }

    selected.executionIds.forEach(executionId =>
        jsonRPC('TestExecution.update', [executionId, { case_text_version: 'latest' }], execution => {
            reloadRowFor(execution)
        })
    )
}

function fileBugFromExecution (execution) {
    // remove all previous event handlers
    $('.one-click-bug-report-form').off('submit')

    // this handler must be here, because if we bind it when the page is loaded.
    // we have no way of knowing for what execution ID the form is submitted for.
    $('.one-click-bug-report-form').submit(() => {
        const trackerId = $('.one-click-bug-report-form #id-issue-tracker').val()
        jsonRPC('Bug.report', [execution.id, trackerId], result => {
            // close the modal
            $('#one-click-bug-report-modal button.close').click()

            if (result.rc !== 0) {
                alert(result.response)
                return
            }

            reloadRowFor(execution)

            // unescape b/c Issue #1533
            const targetUrl = result.response.replace(/&amp;/g, '&')
            showLastBugForTe($(`.test-execution-${execution.id}`), targetUrl)
            window.open(targetUrl, '_blank')
        })
        return false
    })

    return true // so that the modal is opened
}

function addLinkToExecutions (testExecutionIDs) {
    // remove all previous event handlers
    $('.add-hyperlink-form').off('submit')

    // this handler must be here, because if we bind it when the page is loaded.
    // we have no way of knowing for what execution ID the form is submitted for.
    $('.add-hyperlink-form').submit(() => {
        const url = $('.add-hyperlink-form #id_url').val()
        const name = $('.add-hyperlink-form #id_name').val()
        const isDefect = $('.add-hyperlink-form #defectCheckbox').is(':checked')
        const updateTracker = true

        testExecutionIDs.forEach(testExecutionId => {
            jsonRPC('TestExecution.add_link', [{
                execution_id: testExecutionId,
                url,
                name,
                is_defect: isDefect
            }, updateTracker], link => {
                const testExecutionRow = $(`div.list-group-item.test-execution-${testExecutionId}`)
                animate(testExecutionRow, () => {
                    if (link.is_defect) {
                        showLastBugForTe(testExecutionRow, link.url)
                    }
                    const ul = testExecutionRow.find('.test-execution-hyperlinks')
                    ul.append(renderLink(link))
                    bindDeleteLinkButton()
                })
            })
        })

        // clean the values
        $('.add-hyperlink-form #id_name').val('')
        $('.add-hyperlink-form #id_url').val('')
        $('.add-hyperlink-form #defectCheckbox').bootstrapSwitch('state', false)
        $('.add-hyperlink-form #autoUpdateCheckbox').bootstrapSwitch('state', false)

        // close the modal
        $('#add-link-modal button.close').click()

        return false
    })

    return true // so that the modal is opened
}

function renderLink (link) {
    const linkEntryTemplate = $('#link-entry')[0].content
    const template = $(linkEntryTemplate.cloneNode(true))
    if (link.is_defect) {
        template.find('.link-icon').addClass('fa fa-bug')
        const bugTooltip = template.find('.bug-tooltip')
        bugTooltip.css('visibility', 'visible')

        template.find('[data-toggle=popover]')
            .popovers()
            .on('show.bs.popover', () => fetchBugDetails({ href: link.url }, bugTooltip))
    }

    const linkUrlEl = template.find('.link-url')
    linkUrlEl.html(link.name || link.url)
    linkUrlEl.attr('href', link.url)
    template.find('.js-remove-linkreference').attr('data-link-id', link.id)
    template.find('li').attr('data-link-id', link.id)

    return template
}

export function bindDeleteLinkButton () {
    $('.js-remove-linkreference').click(function (event) {
        const row = $(event.target).parents('li')
        const linkId = $(event.target).parent('.js-remove-linkreference').data('link-id')

        if (linkId) {
            jsonRPC('TestExecution.remove_link', { pk: linkId }, () => {
                $(row).fadeOut(500)
            })
        }
        return false
    })
}

function removeCases (executionIds) {
    for (const executionId of executionIds) {
        jsonRPC('TestExecution.remove', { id: executionId }, () => {
            $(`#test-execution-${executionId}`).remove()

            expandedExecutionIds.splice(expandedExecutionIds.indexOf(executionId), 1)
            delete allExecutions[executionId]

            const testExecutionCountEl = $('.test-executions-count')
            const count = parseInt(testExecutionCountEl[0].innerText)
            testExecutionCountEl.html(count - 1)
        }, true)
    }

    drawPercentBar(Object.values(allExecutions))
}

function testExecutionUpdateArgs (statusId) {
    const statusWeight = allExecutionStatuses[statusId].weight

    const updateArgs = { status: statusId, stop_date: '' }
    if (statusWeight !== 0) {
        const timeZone = $('#clock').data('time-zone')
        updateArgs.stop_date = currentTimeWithTimezone(timeZone)
    }

    return updateArgs
}
